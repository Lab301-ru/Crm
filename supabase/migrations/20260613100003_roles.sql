-- ============================================================
-- Задача 8 + «снять ограничения мастера».
-- Модель доступа теперь двухуровневая:
--   admin  — всё;
--   staff (manager + master) — всё, КРОМЕ: правки org_settings,
--          создания сотрудников и УДАЛЕНИЯ заказов.
-- Целостность данных сохраняем для всех не-админов (системные поля
-- заказа неизменяемы). Импорт справочника остаётся за админом.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Мягкое удаление ЗАКАЗА — только админ (прочие таблицы: admin+manager)
-- ------------------------------------------------------------
create or replace function public.fn_guard_soft_delete()
returns trigger
language plpgsql
as $$
begin
  if new.deleted_at is distinct from old.deleted_at then
    if tg_table_name = 'orders' and public.app_role() <> 'admin' then
      raise exception 'Удаление заказа доступно только администратору';
    elsif public.app_role() not in ('admin', 'manager') then
      raise exception 'Удаление доступно только администратору или менеджеру';
    end if;
  end if;
  if new.deleted_at is not null and old.deleted_at is null then
    new.deleted_by := coalesce(new.deleted_by, auth.uid());
  end if;
  return new;
end $$;

-- ------------------------------------------------------------
-- 2. Снимаем мастер-ограничения на поля: оставляем только защиту
--    системных ссылок (неизменяемы для всех, кроме админа).
-- ------------------------------------------------------------
create or replace function public.fn_guard_order_columns()
returns trigger
language plpgsql
as $$
begin
  if (new.client_id, new.device_id, new.number, new.display_number, new.qr_token)
     is distinct from
     (old.client_id, old.device_id, old.number, old.display_number, old.qr_token)
     and public.app_role() <> 'admin' then
    raise exception 'Системные поля заказа (клиент, устройство, номер, токен) неизменяемы';
  end if;
  return new;
end $$;

-- Мастер снова может менять категорию/бренд/модель устройства
drop trigger if exists trg_devices_guard_columns on public.devices;
drop function if exists public.fn_guard_device_columns();

-- ------------------------------------------------------------
-- 3. RLS: заказы/клиенты/устройства — любому активному сотруднику
--    (мастер больше не ограничен своими заказами).
-- ------------------------------------------------------------
drop policy if exists orders_select on public.orders;
create policy orders_select on public.orders
  for select to authenticated using (public.is_active_staff());
drop policy if exists orders_insert on public.orders;
create policy orders_insert on public.orders
  for insert to authenticated with check (public.is_active_staff());
drop policy if exists orders_update on public.orders;
create policy orders_update on public.orders
  for update to authenticated using (public.is_active_staff()) with check (public.is_active_staff());

drop policy if exists clients_select on public.clients;
create policy clients_select on public.clients
  for select to authenticated using (public.is_active_staff());
drop policy if exists clients_insert on public.clients;
create policy clients_insert on public.clients
  for insert to authenticated with check (public.is_active_staff());
drop policy if exists clients_update on public.clients;
create policy clients_update on public.clients
  for update to authenticated using (public.is_active_staff()) with check (public.is_active_staff());

drop policy if exists devices_select on public.devices;
create policy devices_select on public.devices
  for select to authenticated using (public.is_active_staff());
drop policy if exists devices_insert on public.devices;
create policy devices_insert on public.devices
  for insert to authenticated with check (public.is_active_staff());
drop policy if exists devices_update on public.devices;
create policy devices_update on public.devices
  for update to authenticated using (public.is_active_staff()) with check (public.is_active_staff());

-- ------------------------------------------------------------
-- 4. RPC приёмки и справочника — любому активному сотруднику.
--    create_order также принимает cost_price у позиций (задача 1).
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
  if not public.is_active_staff() then
    raise exception 'Создание заказа доступно сотрудникам сервиса';
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
    insert into order_items (order_id, item_type, name, price, qty, cost_price)
    select v_order.id, i ->> 'item_type', i ->> 'name',
           (i ->> 'price')::numeric, coalesce((i ->> 'qty')::numeric, 1),
           coalesce((i ->> 'cost_price')::numeric, 0)
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
  if not public.is_active_staff() then
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

create or replace function public.quick_add_brand(p_brand text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_brand_id uuid;
begin
  if not public.is_active_staff() then
    raise exception 'Доступ запрещён';
  end if;
  if btrim(coalesce(p_brand, '')) = '' then
    raise exception 'Бренд обязателен';
  end if;

  insert into brands (name) values (btrim(p_brand))
  on conflict (name_normalized) do update set name = brands.name
  returning id into v_brand_id;

  return jsonb_build_object('brand_id', v_brand_id);
end $$;

-- Смена статуса: мастер больше не ограничен своими заказами
-- (переходы по таблице сохраняются для всех не-админов).
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

  if v_order.status = p_to then
    return;
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
-- 5. Дашборд: выручка видна всем активным сотрудникам (мастер тоже).
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
    'revenue_today', (
      select coalesce(sum(t.grand_total), 0) from orders_with_totals t
      where t.deleted_at is null and t.id in (
        select distinct h.order_id from order_status_history h
        where h.to_status = 'issued'
          and (h.created_at at time zone v_tz)::date = v_today
      )
    ),
    'revenue_total', (
      select coalesce(sum(t.grand_total), 0) from orders_with_totals t
      where t.deleted_at is null and t.status = 'issued'
    )
  ) into result;

  return result;
end $$;
