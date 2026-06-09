-- ============================================================
-- Миграция 3: триггеры целостности — аудит, soft delete,
-- state machine, валидация динамических полей
-- ============================================================

-- ------------------------------------------------------------
-- Аудит: компактный diff только изменённых полей
-- security definer → insert в audit_log минует RLS
-- ------------------------------------------------------------
create or replace function public.fn_audit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_action text;
  v_changed jsonb;
begin
  if tg_op = 'INSERT' then
    v_action := 'INSERT';
    v_changed := jsonb_strip_nulls(to_jsonb(new)) - 'created_at' - 'updated_at';
  else
    select jsonb_object_agg(n.key, jsonb_build_object('old', o.value, 'new', n.value))
      into v_changed
    from jsonb_each(to_jsonb(old)) o
    join jsonb_each(to_jsonb(new)) n using (key)
    where o.value is distinct from n.value
      and n.key <> 'updated_at';

    if v_changed is null then
      return new;  -- ничего содержательного не изменилось
    end if;

    v_action := case
      when (to_jsonb(new) ->> 'deleted_at') is not null
       and (to_jsonb(old) ->> 'deleted_at') is null then 'SOFT_DELETE'
      else 'UPDATE'
    end;
  end if;

  insert into audit_log (table_name, record_id, action, actor_id, changed)
  values (tg_table_name, (to_jsonb(new) ->> 'id'), v_action, auth.uid(), v_changed);

  return new;
end $$;

do $$
declare
  t text;
begin
  foreach t in array array[
    'profiles', 'org_settings', 'clients', 'categories', 'brands', 'models',
    'field_templates', 'devices', 'orders', 'order_items', 'attachments',
    'notification_rules'
  ] loop
    execute format(
      'create trigger trg_%s_audit after insert or update on public.%I
       for each row execute function public.fn_audit()', t, t);
  end loop;
end $$;

-- ------------------------------------------------------------
-- Физический DELETE запрещён везде, где есть пользовательские данные
-- ------------------------------------------------------------
create or replace function public.fn_forbid_delete()
returns trigger
language plpgsql
as $$
begin
  raise exception 'Физическое удаление запрещено: используйте deleted_at (soft delete)';
end $$;

do $$
declare
  t text;
begin
  foreach t in array array[
    'profiles', 'org_settings', 'clients', 'categories', 'brands', 'models',
    'field_templates', 'devices', 'orders', 'order_items', 'attachments',
    'order_documents', 'order_status_history', 'audit_log', 'notification_outbox'
  ] loop
    execute format(
      'create trigger trg_%s_forbid_delete before delete on public.%I
       for each row execute function public.fn_forbid_delete()', t, t);
  end loop;
end $$;

-- ------------------------------------------------------------
-- Append-only: история статусов и аудит не редактируются
-- ------------------------------------------------------------
create or replace function public.fn_forbid_update()
returns trigger
language plpgsql
as $$
begin
  raise exception 'Таблица % append-only: изменение записей запрещено', tg_table_name;
end $$;

create trigger trg_history_forbid_update before update on public.order_status_history
  for each row execute function public.fn_forbid_update();
create trigger trg_audit_forbid_update before update on public.audit_log
  for each row execute function public.fn_forbid_update();

-- ------------------------------------------------------------
-- Клиенты: нормализация телефона
-- ------------------------------------------------------------
create or replace function public.fn_client_phone()
returns trigger
language plpgsql
as $$
begin
  new.phone_display := coalesce(new.phone_display, new.phone);
  new.phone := public.normalize_phone(coalesce(new.phone_display, new.phone));
  if new.phone is null then
    raise exception 'Телефон клиента обязателен';
  end if;
  return new;
end $$;

create trigger trg_clients_phone before insert or update on public.clients
  for each row execute function public.fn_client_phone();

-- ------------------------------------------------------------
-- Шаблоны полей: key и тип неизменяемы (иначе старые значения
-- перестанут проходить валидацию)
-- ------------------------------------------------------------
create or replace function public.fn_field_template_immutable()
returns trigger
language plpgsql
as $$
begin
  if new.key <> old.key then
    raise exception 'key поля изменять нельзя — создайте новое поле';
  end if;
  if new.field_type <> old.field_type then
    raise exception 'Тип поля изменять нельзя — создайте новое поле';
  end if;
  return new;
end $$;

create trigger trg_field_templates_immutable before update on public.field_templates
  for each row execute function public.fn_field_template_immutable();

-- ------------------------------------------------------------
-- Валидация custom_fields устройства по шаблонам категории
-- ------------------------------------------------------------
create or replace function public.fn_validate_custom_fields()
returns trigger
language plpgsql
as $$
declare
  tpl record;
  val jsonb;
  k text;
begin
  new.custom_fields := coalesce(new.custom_fields, '{}'::jsonb);

  -- ключи, которых нет в шаблонах категории, запрещены
  for k in select jsonb_object_keys(new.custom_fields) loop
    if not exists (
      select 1 from public.field_templates t
      where t.category_id = new.category_id and t.key = k and t.deleted_at is null
    ) then
      raise exception 'Поле "%" не определено для этой категории', k;
    end if;
  end loop;

  for tpl in
    select * from public.field_templates t
    where t.category_id = new.category_id and t.deleted_at is null
  loop
    val := new.custom_fields -> tpl.key;

    if val is null or jsonb_typeof(val) = 'null' then
      -- обязательность проверяем только при приёмке (INSERT),
      -- чтобы новые required-поля не блокировали правки старых заказов
      if tpl.is_required and tpl.is_active and tg_op = 'INSERT' then
        raise exception 'Поле "%" обязательно для заполнения', tpl.label;
      end if;
      continue;
    end if;

    case tpl.field_type
      when 'text' then
        if jsonb_typeof(val) <> 'string' then
          raise exception 'Поле "%": ожидается строка', tpl.label;
        end if;
      when 'number' then
        if jsonb_typeof(val) <> 'number' then
          raise exception 'Поле "%": ожидается число', tpl.label;
        end if;
      when 'boolean' then
        if jsonb_typeof(val) <> 'boolean' then
          raise exception 'Поле "%": ожидается да/нет', tpl.label;
        end if;
      when 'date' then
        if jsonb_typeof(val) <> 'string' or (val #>> '{}') !~ '^\d{4}-\d{2}-\d{2}$' then
          raise exception 'Поле "%": ожидается дата ГГГГ-ММ-ДД', tpl.label;
        end if;
        perform (val #>> '{}')::date;
      when 'select' then
        if jsonb_typeof(val) <> 'string' or not (coalesce(tpl.options, '[]'::jsonb) ? (val #>> '{}')) then
          raise exception 'Поле "%": значение не из списка допустимых', tpl.label;
        end if;
      when 'multiselect' then
        if jsonb_typeof(val) <> 'array' or not (val <@ coalesce(tpl.options, '[]'::jsonb)) then
          raise exception 'Поле "%": значения не из списка допустимых', tpl.label;
        end if;
    end case;
  end loop;

  return new;
end $$;

create trigger trg_devices_custom_fields before insert or update on public.devices
  for each row execute function public.fn_validate_custom_fields();

-- ------------------------------------------------------------
-- Заказ: номер, display_number, дефолты — до вставки
-- ------------------------------------------------------------
create or replace function public.fn_order_before_insert()
returns trigger
language plpgsql
as $$
declare
  v_prefix text;
  v_warranty int;
begin
  if new.number is null then
    new.number := nextval('public.order_number_seq');
  end if;

  select order_prefix, default_warranty_days into v_prefix, v_warranty
  from public.org_settings where id = 1;

  if new.display_number is null then
    new.display_number := coalesce(v_prefix, 'L') || '-' || new.number;
  end if;
  if new.accepted_at is null and new.status = 'accepted' then
    new.accepted_at := now();
  end if;
  if new.warranty_days is null then
    new.warranty_days := coalesce(v_warranty, 0);
  end if;
  return new;
end $$;

create trigger trg_orders_before_insert before insert on public.orders
  for each row execute function public.fn_order_before_insert();

-- ------------------------------------------------------------
-- Статус заказа меняется только через change_status()
-- (функция выставляет транзакционный флаг app.status_change)
-- ------------------------------------------------------------
create or replace function public.fn_guard_status_change()
returns trigger
language plpgsql
as $$
begin
  if new.status is distinct from old.status
     and coalesce(current_setting('app.status_change', true), '') <> 'on' then
    raise exception 'Статус заказа меняется только через change_status()';
  end if;
  return new;
end $$;

create trigger trg_orders_guard_status before update on public.orders
  for each row execute function public.fn_guard_status_change();

-- ------------------------------------------------------------
-- Soft delete заказов/клиентов/строк/файлов — только админ и менеджер
-- ------------------------------------------------------------
create or replace function public.fn_guard_soft_delete()
returns trigger
language plpgsql
as $$
begin
  if new.deleted_at is distinct from old.deleted_at
     and public.app_role() not in ('admin', 'manager') then
    raise exception 'Удаление доступно только администратору или менеджеру';
  end if;
  if new.deleted_at is not null and old.deleted_at is null then
    new.deleted_by := coalesce(new.deleted_by, auth.uid());
  end if;
  return new;
end $$;

do $$
declare
  t text;
begin
  foreach t in array array['clients', 'orders', 'order_items', 'attachments', 'devices'] loop
    execute format(
      'create trigger trg_%s_guard_soft_delete before update on public.%I
       for each row execute function public.fn_guard_soft_delete()', t, t);
  end loop;
end $$;

-- ------------------------------------------------------------
-- Состав закрытого заказа (Выдан/Утиль) не редактируется
-- ------------------------------------------------------------
create or replace function public.fn_lock_items_on_closed_order()
returns trigger
language plpgsql
as $$
declare
  v_status text;
begin
  select status into v_status from public.orders where id = new.order_id;
  if v_status in ('issued', 'scrapped') and public.app_role() <> 'admin' then
    raise exception 'Заказ закрыт — изменение работ и запчастей запрещено';
  end if;
  return new;
end $$;

create trigger trg_order_items_lock before insert or update on public.order_items
  for each row execute function public.fn_lock_items_on_closed_order();
