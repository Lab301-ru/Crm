-- ============================================================
-- Кассовый учёт выручки: журнал платежей order_payments.
-- Каждый приход денег — событие (предоплата или финальная оплата).
-- Функции выручки читают из журнала по дате фактического поступления.
-- ============================================================

create table if not exists public.order_payments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id),
  amount numeric(12, 2) not null check (amount > 0),
  kind text not null check (kind in ('prepayment', 'final')),
  method text check (method in ('cash', 'card', 'transfer')),
  paid_at timestamptz not null default now(),
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now()
);
create index if not exists idx_order_payments_paid_at on public.order_payments (paid_at);
create index if not exists idx_order_payments_order on public.order_payments (order_id);

alter table public.order_payments enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='order_payments' and policyname='order_payments_select') then
    create policy order_payments_select on public.order_payments for select to authenticated using (public.is_active_staff());
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='order_payments' and policyname='order_payments_insert') then
    create policy order_payments_insert on public.order_payments for insert to authenticated with check (public.is_active_staff());
  end if;
end $$;

-- Один раз бэкфиллим существующие заказы: предоплата на accepted_at,
-- финальный платёж на issued_at (остаток от grand_total).
do $backfill$
begin
  if exists (select 1 from public.order_payments) then return; end if;
  insert into public.order_payments (order_id, amount, kind, paid_at)
  select o.id, o.prepayment, 'prepayment', coalesce(o.accepted_at, o.created_at)
  from public.orders o
  where o.deleted_at is null and o.prepayment > 0;

  insert into public.order_payments (order_id, amount, kind, paid_at)
  select t.id, greatest(t.grand_total - t.prepayment, 0), 'final', t.issued_at
  from public.orders_with_totals t
  where t.deleted_at is null and t.status = 'issued'
    and t.issued_at is not null and (t.grand_total - t.prepayment) > 0;
end $backfill$;

-- Синхронизация предоплаты (идемпотентно, событие датой now()).
create or replace function public.set_order_prepayment(
  p_order_id uuid, p_amount numeric, p_method text default null
) returns void language plpgsql security definer set search_path = public as $$
declare
  v_existing numeric;
begin
  if not public.is_active_staff() then raise exception 'Доступ запрещён'; end if;
  if p_amount is null or p_amount < 0 then raise exception 'Сумма предоплаты не может быть отрицательной'; end if;
  if p_method is not null and p_method not in ('cash','card','transfer') then raise exception 'Недопустимый способ оплаты: %', p_method; end if;

  select coalesce(sum(amount), 0) into v_existing
  from public.order_payments where order_id = p_order_id and kind = 'prepayment';

  if p_amount = v_existing then
    update public.orders set prepayment = p_amount where id = p_order_id;
    return;
  end if;

  delete from public.order_payments where order_id = p_order_id and kind = 'prepayment';
  if p_amount > 0 then
    insert into public.order_payments (order_id, amount, kind, method, paid_at, created_by)
    values (p_order_id, p_amount, 'prepayment', p_method, now(), auth.uid());
  end if;
  update public.orders set prepayment = p_amount where id = p_order_id;
end $$;

revoke execute on function public.set_order_prepayment(uuid, numeric, text) from public, anon;
grant  execute on function public.set_order_prepayment(uuid, numeric, text) to authenticated, service_role;

-- Триггер: при выдаче — финальный платёж на остаток.
create or replace function public.fn_order_payment_on_issued()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_grand numeric; v_paid numeric; v_remain numeric;
begin
  if new.to_status <> 'issued' then return new; end if;
  select grand_total into v_grand from public.orders_with_totals where id = new.order_id;
  select coalesce(sum(amount), 0) into v_paid from public.order_payments where order_id = new.order_id;
  v_remain := greatest(coalesce(v_grand, 0) - v_paid, 0);
  if v_remain > 0 then
    insert into public.order_payments (order_id, amount, kind, paid_at, created_by)
    values (new.order_id, v_remain, 'final', new.created_at, new.changed_by);
  end if;
  return new;
end $$;

drop trigger if exists trg_order_payment_on_issued on public.order_status_history;
create trigger trg_order_payment_on_issued
  after insert on public.order_status_history
  for each row execute function public.fn_order_payment_on_issued();

-- Выручка (кассовый метод) — по журналу платежей.
create or replace function public.finance_stats()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tz text; n timestamp; v jsonb;
begin
  if not public.is_active_staff() then raise exception 'Доступ запрещён'; end if;
  select coalesce(timezone, 'Europe/Moscow') into tz from org_settings where id = 1;
  tz := coalesce(tz, 'Europe/Moscow');
  n := now() at time zone tz;

  with pay as (
    select (p.paid_at at time zone tz) as pt, p.amount, p.order_id
    from public.order_payments p
    join public.orders o on o.id = p.order_id and o.deleted_at is null
  ),
  parts_cost as (
    select p.order_id, p.pt, p.amount,
      (case when t.grand_total > 0 then p.amount / t.grand_total else 0 end) *
        coalesce((select sum(oi.cost_price * oi.qty) from public.order_items oi
                  where oi.order_id = t.id and oi.item_type = 'part' and oi.deleted_at is null), 0) as pc
    from pay p join public.orders_with_totals t on t.id = p.order_id
  ),
  agg as (
    select
      coalesce(sum(amount) filter (where pt >= date_trunc('day',   n) and pt < date_trunc('day',   n) + interval '1 day'),   0) as rev_today,
      coalesce(sum(amount) filter (where pt >= date_trunc('month', n) and pt < date_trunc('month', n) + interval '1 month'), 0) as rev_month,
      coalesce(sum(amount) filter (where pt >= date_trunc('year',  n) and pt < date_trunc('year',  n) + interval '1 year'),  0) as rev_year,
      coalesce(sum(amount), 0) as rev_all,
      coalesce(sum(amount - pc) filter (where pt >= date_trunc('day',   n) and pt < date_trunc('day',   n) + interval '1 day'),   0) as prof_today,
      coalesce(sum(amount - pc) filter (where pt >= date_trunc('month', n) and pt < date_trunc('month', n) + interval '1 month'), 0) as prof_month,
      coalesce(sum(amount - pc) filter (where pt >= date_trunc('year',  n) and pt < date_trunc('year',  n) + interval '1 year'),  0) as prof_year,
      coalesce(sum(amount - pc), 0) as prof_all
    from parts_cost
  )
  select jsonb_build_object(
    'revenue', jsonb_build_object('today', rev_today, 'month', rev_month, 'year', rev_year, 'all', rev_all),
    'profit',  jsonb_build_object('today', prof_today, 'month', prof_month, 'year', prof_year, 'all', prof_all)
  ) into v from agg;
  return v;
end $$;

revoke execute on function public.finance_stats() from public, anon;
grant  execute on function public.finance_stats() to authenticated, service_role;

create or replace function public.finance_overview(p_period text default 'month')
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_tz text; v_today date; v_from date;
  v_revenue numeric; v_expenses numeric; v_by_category jsonb;
  v_stock_revenue numeric; v_stock_cogs numeric; v_stock_profit numeric;
  v_net numeric; v_total_revenue numeric;
begin
  if not public.is_manager_up() then raise exception 'Доступ запрещён'; end if;
  if p_period not in ('today','month','year','all') then raise exception 'Недопустимый период: %', p_period; end if;

  select coalesce(timezone,'Europe/Moscow') into v_tz from org_settings where id = 1;
  v_tz := coalesce(v_tz,'Europe/Moscow');
  v_today := (now() at time zone v_tz)::date;
  v_from := case p_period
    when 'today' then v_today
    when 'month' then date_trunc('month', v_today)::date
    when 'year'  then date_trunc('year', v_today)::date
    else date '0001-01-01' end;

  select coalesce(sum(p.amount), 0) into v_revenue
  from public.order_payments p
  join public.orders o on o.id = p.order_id and o.deleted_at is null
  where (p.paid_at at time zone v_tz)::date between v_from and v_today;

  select coalesce(sum(amount),0) into v_expenses
  from public.expenses where deleted_at is null and spent_on between v_from and v_today;

  select coalesce(jsonb_object_agg(category,total),'{}'::jsonb) into v_by_category
  from (select category, sum(amount) total from public.expenses
        where deleted_at is null and spent_on between v_from and v_today group by category) c;

  select coalesce(sum(total),0), coalesce(sum(cost_total),0)
    into v_stock_revenue, v_stock_cogs
  from public.stock_sales
  where (sold_at at time zone v_tz)::date between v_from and v_today;

  v_stock_profit := v_stock_revenue - v_stock_cogs;
  v_total_revenue := v_revenue + v_stock_revenue;
  v_net := v_revenue + v_stock_profit - v_expenses;

  return jsonb_build_object(
    'period', p_period,
    'revenue', v_revenue,
    'stock_revenue', v_stock_revenue,
    'stock_profit', v_stock_profit,
    'total_revenue', v_total_revenue,
    'expenses', v_expenses,
    'net_profit', v_net,
    'margin', case when v_total_revenue > 0 then round(v_net / v_total_revenue * 100, 1) else 0 end,
    'expenses_by_category', v_by_category
  );
end $$;

revoke execute on function public.finance_overview(text) from public, anon;
grant  execute on function public.finance_overview(text) to authenticated, service_role;

create or replace function public.dashboard_revenue_by_month(p_month text default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_tz text; v_first date; v_last date; result jsonb;
begin
  if not public.is_active_staff() then raise exception 'Доступ запрещён'; end if;

  select coalesce(timezone, 'Europe/Moscow') into v_tz from org_settings where id = 1;
  v_tz := coalesce(v_tz, 'Europe/Moscow');
  v_first := date_trunc('month', coalesce(nullif(p_month,'')::date, (now() at time zone v_tz)::date))::date;
  v_last  := (v_first + interval '1 month' - interval '1 day')::date;

  with pay as (
    select (p.paid_at at time zone v_tz)::date as d, p.amount, p.order_id
    from public.order_payments p
    join public.orders o on o.id = p.order_id and o.deleted_at is null
    where p.paid_at <= now()
      and (p.paid_at at time zone v_tz)::date between v_first and v_last
  ),
  parts as (
    select p.order_id, p.d, p.amount,
      (case when t.grand_total > 0 then p.amount / t.grand_total else 0 end) *
        coalesce((select sum(oi.cost_price * oi.qty) from public.order_items oi
                  where oi.order_id = p.order_id and oi.item_type = 'part' and oi.deleted_at is null), 0) as pc
    from pay p join public.orders_with_totals t on t.id = p.order_id
  ),
  days as (select gs::date as d from generate_series(v_first, v_last, interval '1 day') gs)
  select jsonb_build_object(
    'month', to_char(v_first, 'YYYY-MM'),
    'revenue_total', coalesce((select sum(amount) from parts), 0),
    'profit_total', coalesce((select sum(amount - pc) from parts), 0),
    'days', coalesce((select jsonb_agg(jsonb_build_object(
        'date', to_char(d.d, 'YYYY-MM-DD'),
        'revenue', coalesce((select sum(amount) from parts p where p.d = d.d), 0),
        'profit',  coalesce((select sum(amount - pc) from parts p where p.d = d.d), 0)
      ) order by d.d) from days d), '[]'::jsonb)
  ) into result;
  return result;
end $$;

revoke execute on function public.dashboard_revenue_by_month(text) from public, anon;
grant  execute on function public.dashboard_revenue_by_month(text) to authenticated, service_role;

-- create_order: при ненулевой предоплате пишем событие в журнал сразу.
create or replace function public.create_order(p_client jsonb, p_device jsonb, p_order jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_client_id uuid; v_device_id uuid; v_initial text;
  v_order orders%rowtype;
  v_od_id uuid; v_extra jsonb; v_extra_device uuid; v_extra_od uuid;
  v_pos int := 1; v_prepay numeric;
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
    values (p_client ->> 'name', p_client ->> 'phone', p_client ->> 'messenger',
            nullif(p_client ->> 'email', ''), p_client ->> 'comment')
    returning id into v_client_id;
  end if;

  insert into devices (category_id, brand_id, model_id, serial_number, completeness,
                       appearance, is_warranty_case, custom_fields)
  values ((p_device ->> 'category_id')::uuid, (p_device ->> 'brand_id')::uuid,
          nullif(p_device ->> 'model_id', '')::uuid, p_device ->> 'serial_number',
          p_device ->> 'completeness', p_device ->> 'appearance',
          coalesce((p_device ->> 'is_warranty_case')::boolean, false),
          coalesce(p_device -> 'custom_fields', '{}'::jsonb))
  returning id into v_device_id;

  v_prepay := coalesce((p_order ->> 'prepayment')::numeric, 0);
  insert into orders (client_id, device_id, status, manager_id, master_id, due_date,
                      claimed_defect, prepayment, warranty_days, linked_order_id)
  values (v_client_id, v_device_id, v_initial, auth.uid(),
          nullif(p_order ->> 'master_id', '')::uuid, nullif(p_order ->> 'due_date', '')::date,
          p_order ->> 'claimed_defect', v_prepay,
          nullif(p_order ->> 'warranty_days', '')::int, nullif(p_order ->> 'linked_order_id', '')::uuid)
  returning * into v_order;

  insert into order_status_history (order_id, from_status, to_status, changed_by, comment)
  values (v_order.id, null, v_initial, auth.uid(), 'Заказ создан');

  insert into order_devices (order_id, device_id, position, claimed_defect, warranty_days)
  values (v_order.id, v_device_id, 1, p_order ->> 'claimed_defect',
          nullif(p_order ->> 'warranty_days', '')::int)
  returning id into v_od_id;

  if p_order ? 'items' then
    insert into order_items (order_id, order_device_id, item_type, name, price, qty, cost_price)
    select v_order.id, v_od_id, i ->> 'item_type', i ->> 'name',
           (i ->> 'price')::numeric, coalesce((i ->> 'qty')::numeric, 1),
           coalesce((i ->> 'cost_price')::numeric, 0)
    from jsonb_array_elements(p_order -> 'items') i;
  end if;

  if p_order ? 'devices' then
    for v_extra in select * from jsonb_array_elements(p_order -> 'devices') loop
      v_pos := v_pos + 1;
      insert into devices (category_id, brand_id, model_id, serial_number, completeness,
                           appearance, is_warranty_case, custom_fields)
      values ((v_extra ->> 'category_id')::uuid, (v_extra ->> 'brand_id')::uuid,
              nullif(v_extra ->> 'model_id', '')::uuid, v_extra ->> 'serial_number',
              v_extra ->> 'completeness', v_extra ->> 'appearance',
              coalesce((v_extra ->> 'is_warranty_case')::boolean, false),
              coalesce(v_extra -> 'custom_fields', '{}'::jsonb))
      returning id into v_extra_device;

      insert into order_devices (order_id, device_id, position, claimed_defect, warranty_days)
      values (v_order.id, v_extra_device, v_pos, v_extra ->> 'claimed_defect',
              nullif(v_extra ->> 'warranty_days', '')::int)
      returning id into v_extra_od;

      if v_extra ? 'items' then
        insert into order_items (order_id, order_device_id, item_type, name, price, qty, cost_price)
        select v_order.id, v_extra_od, i ->> 'item_type', i ->> 'name',
               (i ->> 'price')::numeric, coalesce((i ->> 'qty')::numeric, 1),
               coalesce((i ->> 'cost_price')::numeric, 0)
        from jsonb_array_elements(v_extra -> 'items') i;
      end if;
    end loop;
  end if;

  if v_prepay > 0 then
    insert into public.order_payments (order_id, amount, kind, paid_at, created_by)
    values (v_order.id, v_prepay, 'prepayment', now(), auth.uid());
  end if;

  if v_initial = 'accepted' then
    perform public.fn_enqueue_notifications(v_order.id, 'order_accepted');
  end if;

  return jsonb_build_object('id', v_order.id, 'display_number', v_order.display_number,
    'qr_token', v_order.qr_token, 'client_id', v_client_id, 'device_id', v_device_id);
end $$;
