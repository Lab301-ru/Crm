-- ============================================================
-- Миграция 4: бизнес-функции, view, права на функции
-- ============================================================

-- ------------------------------------------------------------
-- Проверки доступа (definer — без рекурсии RLS на profiles)
-- ------------------------------------------------------------
create or replace function public.is_active_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from profiles where id = auth.uid() and is_active);
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
as $$
  select public.app_role() = 'admin' and public.is_active_staff();
$$;

create or replace function public.is_manager_up()
returns boolean
language sql
stable
as $$
  select public.app_role() in ('admin', 'manager') and public.is_active_staff();
$$;

create or replace function public.is_master()
returns boolean
language sql
stable
as $$
  select public.app_role() = 'master' and public.is_active_staff();
$$;

-- ------------------------------------------------------------
-- Постановка уведомлений в outbox (внутренняя)
-- ------------------------------------------------------------
create or replace function public.fn_enqueue_notifications(p_order_id uuid, p_event text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order orders%rowtype;
  v_client clients%rowtype;
  r record;
  v_recipient text;
begin
  select * into v_order from orders where id = p_order_id;
  if not found then return; end if;
  select * into v_client from clients where id = v_order.client_id;

  for r in select * from notification_rules where event_type = p_event and enabled loop
    v_recipient := case r.channel
      when 'telegram' then v_client.telegram_chat_id::text
      when 'email' then v_client.email
      when 'phone_call' then v_client.phone
    end;

    insert into notification_outbox (event_key, order_id, event_type, channel, recipient, payload, status)
    values (
      v_order.id::text || ':' || p_event || ':' || r.channel,
      v_order.id, p_event, r.channel, v_recipient,
      jsonb_build_object(
        'order_number', v_order.display_number,
        'client_name', v_client.name,
        'status_label', (select label from statuses where code = v_order.status),
        'due_date', v_order.due_date,
        'qr_token', v_order.qr_token,
        'template', r.template
      ),
      case when v_recipient is null or v_recipient = '' then 'skipped' else 'pending' end
    )
    on conflict (event_key) do nothing;  -- идемпотентность
  end loop;
end $$;

-- ------------------------------------------------------------
-- Смена статуса: единственная дверь state machine
-- ------------------------------------------------------------
create or replace function public.change_status(p_order_id uuid, p_to text, p_comment text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order orders%rowtype;
  v_event text;
begin
  if not public.is_active_staff() then
    raise exception 'Доступ запрещён';
  end if;

  select * into v_order from orders
  where id = p_order_id and deleted_at is null
  for update;
  if not found then
    raise exception 'Заказ не найден';
  end if;

  if public.app_role() = 'master' and v_order.master_id is distinct from auth.uid() then
    raise exception 'Мастер меняет статус только своих заказов';
  end if;

  if v_order.status = p_to then
    return;  -- идемпотентность повторного нажатия
  end if;

  if not exists (
    select 1 from status_transitions
    where from_code = v_order.status and to_code = p_to
  ) and public.app_role() <> 'admin' then
    raise exception 'Переход "%" → "%" запрещён', v_order.status, p_to;
  end if;

  perform set_config('app.status_change', 'on', true);
  update orders set status = p_to where id = p_order_id;
  perform set_config('app.status_change', '', true);

  insert into order_status_history (order_id, from_status, to_status, changed_by, comment)
  values (p_order_id, v_order.status, p_to, auth.uid(), p_comment);

  v_event := case p_to
    when 'accepted' then 'order_accepted'
    when 'awaiting_approval' then 'cost_approval'
    when 'awaiting_parts' then 'awaiting_parts'
    when 'ready' then 'order_ready'
    when 'issued' then 'order_issued'
    else null
  end;

  if v_event is not null then
    perform public.fn_enqueue_notifications(p_order_id, v_event);
  end if;
end $$;

-- ------------------------------------------------------------
-- Создание заказа одной транзакцией: клиент + устройство + заказ
-- p_client: {id?} либо {name, phone, messenger?, email?, comment?}
-- p_device: {category_id, brand_id, model_id?, serial_number?, completeness?,
--            appearance?, is_warranty_case?, custom_fields?}
-- p_order:  {initial_status? (new|accepted), master_id?, due_date?,
--            claimed_defect, prepayment?, warranty_days?, linked_order_id?,
--            items?: [{item_type, name, price, qty?}]}
-- ------------------------------------------------------------
create or replace function public.create_order(p_client jsonb, p_device jsonb, p_order jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_client_id uuid;
  v_device_id uuid;
  v_initial text;
  v_order orders%rowtype;
begin
  if not public.is_manager_up() then
    raise exception 'Создание заказа доступно администратору и менеджеру';
  end if;

  v_initial := coalesce(p_order ->> 'initial_status', 'accepted');
  if v_initial not in ('new', 'accepted') then
    raise exception 'Недопустимый начальный статус: %', v_initial;
  end if;

  v_client_id := nullif(p_client ->> 'id', '')::uuid;
  if v_client_id is null then
    insert into clients (name, phone_display, messenger, email, comment)
    values (
      p_client ->> 'name',
      p_client ->> 'phone',
      p_client ->> 'messenger',
      nullif(p_client ->> 'email', ''),
      p_client ->> 'comment'
    )
    returning id into v_client_id;
  end if;

  insert into devices (category_id, brand_id, model_id, serial_number, completeness,
                       appearance, is_warranty_case, custom_fields)
  values (
    (p_device ->> 'category_id')::uuid,
    (p_device ->> 'brand_id')::uuid,
    nullif(p_device ->> 'model_id', '')::uuid,
    p_device ->> 'serial_number',
    p_device ->> 'completeness',
    p_device ->> 'appearance',
    coalesce((p_device ->> 'is_warranty_case')::boolean, false),
    coalesce(p_device -> 'custom_fields', '{}'::jsonb)
  )
  returning id into v_device_id;

  insert into orders (client_id, device_id, status, manager_id, master_id, due_date,
                      claimed_defect, prepayment, warranty_days, linked_order_id)
  values (
    v_client_id,
    v_device_id,
    v_initial,
    auth.uid(),
    nullif(p_order ->> 'master_id', '')::uuid,
    nullif(p_order ->> 'due_date', '')::date,
    p_order ->> 'claimed_defect',
    coalesce((p_order ->> 'prepayment')::numeric, 0),
    nullif(p_order ->> 'warranty_days', '')::int,
    nullif(p_order ->> 'linked_order_id', '')::uuid
  )
  returning * into v_order;

  insert into order_status_history (order_id, from_status, to_status, changed_by, comment)
  values (v_order.id, null, v_initial, auth.uid(), 'Заказ создан');

  if p_order ? 'items' then
    insert into order_items (order_id, item_type, name, price, qty)
    select v_order.id, i ->> 'item_type', i ->> 'name',
           (i ->> 'price')::numeric, coalesce((i ->> 'qty')::numeric, 1)
    from jsonb_array_elements(p_order -> 'items') i;
  end if;

  if v_initial = 'accepted' then
    perform public.fn_enqueue_notifications(v_order.id, 'order_accepted');
  end if;

  return jsonb_build_object(
    'id', v_order.id,
    'display_number', v_order.display_number,
    'qr_token', v_order.qr_token,
    'client_id', v_client_id,
    'device_id', v_device_id
  );
end $$;

-- ------------------------------------------------------------
-- Быстрое добавление модели из формы заказа (Workpan: < 60 сек)
-- ------------------------------------------------------------
create or replace function public.quick_add_model(p_category_id uuid, p_brand text, p_model text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_brand_id uuid;
  v_model_id uuid;
begin
  if not public.is_manager_up() then
    raise exception 'Доступ запрещён';
  end if;
  if btrim(coalesce(p_brand, '')) = '' or btrim(coalesce(p_model, '')) = '' then
    raise exception 'Бренд и модель обязательны';
  end if;

  insert into brands (name) values (btrim(p_brand))
  on conflict (name_normalized) do update set name = brands.name
  returning id into v_brand_id;

  insert into models (category_id, brand_id, name)
  values (p_category_id, v_brand_id, btrim(p_model))
  on conflict (category_id, brand_id, name_normalized) do update set name = models.name
  returning id into v_model_id;

  return jsonb_build_object('brand_id', v_brand_id, 'model_id', v_model_id);
end $$;

-- ------------------------------------------------------------
-- Пакетный импорт справочника (CSV/XLSX парсится на клиенте)
-- p_rows: [{category, brand, model}, ...] — до ~500 строк за вызов
-- ------------------------------------------------------------
create or replace function public.import_catalog_batch(p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  v_cat_id uuid;
  v_brand_id uuid;
  v_model_id uuid;
  v_inserted int := 0;
  v_skipped int := 0;
  v_errors jsonb := '[]'::jsonb;
  v_idx int := 0;
begin
  if not public.is_admin() then
    raise exception 'Импорт доступен только администратору';
  end if;

  for r in
    select btrim(e ->> 'category') as category,
           btrim(e ->> 'brand') as brand,
           btrim(e ->> 'model') as model
    from jsonb_array_elements(p_rows) e
  loop
    v_idx := v_idx + 1;
    begin
      if coalesce(r.category, '') = '' or coalesce(r.brand, '') = '' or coalesce(r.model, '') = '' then
        raise exception 'Пустая категория, бренд или модель';
      end if;

      select id into v_cat_id from categories
      where name_normalized = lower(r.category) and deleted_at is null;
      if v_cat_id is null then
        insert into categories (name) values (r.category) returning id into v_cat_id;
      end if;

      insert into brands (name) values (r.brand)
      on conflict (name_normalized) do update set name = brands.name
      returning id into v_brand_id;

      insert into models (category_id, brand_id, name)
      values (v_cat_id, v_brand_id, r.model)
      on conflict (category_id, brand_id, name_normalized) do nothing
      returning id into v_model_id;

      if v_model_id is null then
        v_skipped := v_skipped + 1;  -- дубль
      else
        v_inserted := v_inserted + 1;
      end if;
      v_model_id := null;
    exception when others then
      v_errors := v_errors || jsonb_build_object('row', v_idx, 'error', sqlerrm);
    end;
  end loop;

  return jsonb_build_object('inserted', v_inserted, 'skipped', v_skipped, 'errors', v_errors);
end $$;

-- ------------------------------------------------------------
-- View: заказы с суммами (итог всегда согласован со строками)
-- ------------------------------------------------------------
create view public.orders_with_totals
with (security_invoker = true)
as
select
  o.*,
  t.works_total,
  t.parts_total,
  t.works_total + t.parts_total as grand_total,
  t.works_total + t.parts_total - o.prepayment as due_amount,
  (o.due_date is not null
   and o.due_date < current_date
   and o.status not in ('ready', 'issued', 'declined', 'scrapped')) as is_overdue
from public.orders o
left join lateral (
  select
    coalesce(sum(i.price * i.qty) filter (where i.item_type = 'work'), 0)::numeric(12,2) as works_total,
    coalesce(sum(i.price * i.qty) filter (where i.item_type = 'part'), 0)::numeric(12,2) as parts_total
  from public.order_items i
  where i.order_id = o.id and i.deleted_at is null
) t on true;

-- ------------------------------------------------------------
-- View: главная таблица заказов (Workpan-список)
-- ------------------------------------------------------------
create view public.order_list
with (security_invoker = true)
as
select
  o.id, o.display_number, o.status, s.label as status_label, s.color as status_color,
  o.accepted_at, o.due_date, o.is_overdue,
  o.grand_total, o.prepayment, o.due_amount, o.payment_status,
  o.manager_id, o.master_id, o.created_at,
  c.id as client_id, c.name as client_name, c.phone as client_phone,
  cat.name as category_name, b.name as brand_name, m.name as model_name,
  concat_ws(' ', cat.name, b.name, coalesce(m.name, '')) as device_label,
  d.serial_number, d.category_id, d.brand_id
from public.orders_with_totals o
join public.statuses s on s.code = o.status
join public.clients c on c.id = o.client_id
join public.devices d on d.id = o.device_id
join public.categories cat on cat.id = d.category_id
join public.brands b on b.id = d.brand_id
left join public.models m on m.id = d.model_id
where o.deleted_at is null;

-- ------------------------------------------------------------
-- Глобальный поиск: номер заказа / телефон / имя / серийник /
-- бренд / модель / значения доп-полей (IMEI и т.п.)
-- ------------------------------------------------------------
create or replace function public.global_search(p_q text, p_limit int default 10)
returns table (
  order_id uuid, display_number text, client_name text, device_label text,
  status_code text, status_label text, status_color text, matched text, rank real
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  q text := lower(btrim(coalesce(p_q, '')));
  qd text := regexp_replace(coalesce(p_q, ''), '\D', '', 'g');
begin
  if not public.is_active_staff() then
    raise exception 'Доступ запрещён';
  end if;
  if length(q) < 2 then
    return;
  end if;

  return query
  select
    o.id, o.display_number, c.name,
    concat_ws(' ', cat.name, b.name, coalesce(m.name, '')),
    s.code, s.label, s.color,
    case
      when lower(o.display_number) like '%' || q || '%' then 'Номер заказа'
      when qd <> '' and c.phone like '%' || qd || '%' then 'Телефон'
      when d.serial_normalized like '%' || replace(q, ' ', '') || '%' then 'Серийный номер'
      when d.custom_fields::text ilike '%' || q || '%' then 'Доп. поле'
      when lower(b.name) like '%' || q || '%' then 'Бренд'
      when m.id is not null and lower(m.name) like '%' || q || '%' then 'Модель'
      else 'Клиент'
    end,
    greatest(
      similarity(lower(o.display_number), q),
      similarity(lower(c.name), q),
      similarity(coalesce(d.serial_normalized, ''), q),
      similarity(lower(b.name), q),
      similarity(lower(coalesce(m.name, '')), q)
    )
  from orders o
  join clients c on c.id = o.client_id
  join devices d on d.id = o.device_id
  join categories cat on cat.id = d.category_id
  join brands b on b.id = d.brand_id
  left join models m on m.id = d.model_id
  join statuses s on s.code = o.status
  where o.deleted_at is null
    and (public.is_manager_up() or o.master_id = auth.uid())
    and (
      lower(o.display_number) like '%' || q || '%'
      or lower(c.name) like '%' || q || '%'
      or (qd <> '' and length(qd) >= 4 and c.phone like '%' || qd || '%')
      or d.serial_normalized like '%' || replace(q, ' ', '') || '%'
      or d.custom_fields::text ilike '%' || q || '%'
      or lower(b.name) like '%' || q || '%'
      or (m.id is not null and lower(m.name) like '%' || q || '%')
    )
  order by 9 desc, o.created_at desc
  limit p_limit;
end $$;

-- ------------------------------------------------------------
-- Виджеты дашборда
-- ------------------------------------------------------------
create or replace function public.dashboard_stats()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_tz text;
  v_today date;
  result jsonb;
begin
  if not public.is_active_staff() then
    raise exception 'Доступ запрещён';
  end if;

  select timezone into v_tz from org_settings where id = 1;
  v_tz := coalesce(v_tz, 'Europe/Moscow');
  v_today := (now() at time zone v_tz)::date;

  select jsonb_build_object(
    'accepted_today', (
      select count(*) from orders
      where deleted_at is null
        and (accepted_at at time zone v_tz)::date = v_today
    ),
    'in_repair', (
      select count(*) from orders where deleted_at is null and status = 'in_repair'
    ),
    'awaiting_parts', (
      select count(*) from orders where deleted_at is null and status = 'awaiting_parts'
    ),
    'ready', (
      select count(*) from orders where deleted_at is null and status = 'ready'
    ),
    'issued_today', (
      select count(distinct h.order_id) from order_status_history h
      where h.to_status = 'issued'
        and (h.created_at at time zone v_tz)::date = v_today
    ),
    'revenue_today', case when public.is_manager_up() then (
      select coalesce(sum(t.grand_total), 0) from orders_with_totals t
      where t.deleted_at is null and t.id in (
        select distinct h.order_id from order_status_history h
        where h.to_status = 'issued'
          and (h.created_at at time zone v_tz)::date = v_today
      )
    ) end,
    'revenue_total', case when public.is_manager_up() then (
      select coalesce(sum(t.grand_total), 0) from orders_with_totals t
      where t.deleted_at is null and t.status = 'issued'
    ) end
  ) into result;

  return result;
end $$;

-- ------------------------------------------------------------
-- Закрытие ручного уведомления «позвонить клиенту»
-- ------------------------------------------------------------
create or replace function public.mark_phone_call_done(p_outbox_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_active_staff() then
    raise exception 'Доступ запрещён';
  end if;

  update notification_outbox
  set status = 'manual_done', sent_at = now(), done_by = auth.uid()
  where id = p_outbox_id and channel = 'phone_call' and status = 'pending';

  if not found then
    raise exception 'Задача звонка не найдена или уже закрыта';
  end if;
end $$;

-- ------------------------------------------------------------
-- Функции для Edge Functions (только service_role)
-- ------------------------------------------------------------

-- Забрать пачку уведомлений на доставку (конкурентно-безопасно)
create or replace function public.claim_notifications(p_limit int default 20)
returns setof public.notification_outbox
language sql
security definer
set search_path = public
as $$
  update notification_outbox o
  set attempts = o.attempts + 1
  where o.id in (
    select id from notification_outbox
    where status = 'pending'
      and channel in ('telegram', 'email')
      and (next_retry_at is null or next_retry_at <= now())
    order by created_at
    limit p_limit
    for update skip locked
  )
  returning o.*;
$$;

-- Зафиксировать результат доставки (backoff: 1м → 5м → 30м → failed)
create or replace function public.complete_notification(p_id uuid, p_ok boolean, p_error text default null)
returns void
language sql
security definer
set search_path = public
as $$
  update notification_outbox
  set status = case
        when p_ok then 'sent'
        when attempts >= 4 then 'failed'
        else 'pending'
      end,
      sent_at = case when p_ok then now() else sent_at end,
      last_error = p_error,
      next_retry_at = case
        when p_ok or attempts >= 4 then null
        when attempts = 1 then now() + interval '1 minute'
        when attempts = 2 then now() + interval '5 minutes'
        else now() + interval '30 minutes'
      end
  where id = p_id;
$$;

-- Привязка Telegram-чата клиента по токену заказа (/start <qr_token>)
create or replace function public.link_telegram(p_qr_token text, p_chat_id bigint)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_client_id uuid;
begin
  select o.client_id into v_client_id
  from orders o
  where o.qr_token = p_qr_token and o.deleted_at is null;

  if v_client_id is null then
    return false;
  end if;

  update clients set telegram_chat_id = p_chat_id where id = v_client_id;
  return true;
end $$;

-- Публичная QR-страница: только разрешённые поля, ничего лишнего
create or replace function public.public_order_status(p_token text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'order_number', o.display_number,
    'status', s.label,
    'status_color', s.color,
    'accepted_at', o.accepted_at,
    'due_date', o.due_date,
    'service_comment', o.public_comment,
    'org', jsonb_build_object(
      'name', g.name, 'phone', g.phone, 'address', g.address,
      'working_hours', g.working_hours, 'contacts', g.public_contacts
    )
  )
  from orders o
  join statuses s on s.code = o.status
  cross join org_settings g
  where o.qr_token = p_token and o.deleted_at is null and g.id = 1;
$$;

-- ------------------------------------------------------------
-- Права на функции
-- ------------------------------------------------------------
-- Служебные — только service_role (Edge Functions)
revoke execute on function public.claim_notifications(int) from public, anon, authenticated;
revoke execute on function public.complete_notification(uuid, boolean, text) from public, anon, authenticated;
revoke execute on function public.link_telegram(text, bigint) from public, anon, authenticated;
revoke execute on function public.public_order_status(text) from public, anon, authenticated;
revoke execute on function public.fn_enqueue_notifications(uuid, text) from public, anon, authenticated;
grant execute on function public.claim_notifications(int) to service_role;
grant execute on function public.complete_notification(uuid, boolean, text) to service_role;
grant execute on function public.link_telegram(text, bigint) to service_role;
grant execute on function public.public_order_status(text) to service_role;

-- Пользовательские RPC — только авторизованным (проверки ролей внутри)
revoke execute on function public.create_order(jsonb, jsonb, jsonb) from public, anon;
revoke execute on function public.change_status(uuid, text, text) from public, anon;
revoke execute on function public.quick_add_model(uuid, text, text) from public, anon;
revoke execute on function public.import_catalog_batch(jsonb) from public, anon;
revoke execute on function public.global_search(text, int) from public, anon;
revoke execute on function public.dashboard_stats() from public, anon;
revoke execute on function public.mark_phone_call_done(uuid) from public, anon;

grant select on public.orders_with_totals, public.order_list to authenticated, service_role;
