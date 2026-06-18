-- ============================================================
-- #2/#3/#5: дата выдачи заказа + аналитика для дашборда.
--   • orders.issued_at — момент перехода в «Выдан» (фильтр «выдано за
--     период» и графики);
--   • триггер проставляет issued_at при записи перехода в 'issued';
--   • вьюхи orders_with_totals / order_list пересоздаются с issued_at
--     (o.* раскрывается в фиксированный список — обычный ALTER не помогает);
--   • dashboard_stats + issued_total; dashboard_analytics() — статусы и
--     выручка/прибыль по дням за 14 дней.
-- ============================================================

alter table public.orders add column if not exists issued_at timestamptz;

-- issued_at проставляется при появлении перехода в «Выдан» (история
-- append-only → AFTER INSERT). Меняется отдельное поле, не статус —
-- охранные триггеры не задеваются.
create or replace function public.fn_set_issued_at()
returns trigger
language plpgsql
as $$
begin
  if new.to_status = 'issued' then
    update public.orders set issued_at = new.created_at where id = new.order_id;
  end if;
  return new;
end $$;

drop trigger if exists trg_history_set_issued_at on public.order_status_history;
create trigger trg_history_set_issued_at
  after insert on public.order_status_history
  for each row execute function public.fn_set_issued_at();

-- Бэкофилл для уже выданных заказов (последняя выдача из истории).
update public.orders o
set issued_at = h.t
from (
  select order_id, max(created_at) as t
  from public.order_status_history
  where to_status = 'issued'
  group by order_id
) h
where h.order_id = o.id and o.issued_at is null;

-- Пересоздаём вьюхи, чтобы o.* включил issued_at (order_list зависит от
-- orders_with_totals — дропаем в правильном порядке, гранты возвращаем).
drop view if exists public.order_list;
drop view if exists public.orders_with_totals;

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
  d.serial_number, d.category_id, d.brand_id,
  o.issued_at
from public.orders_with_totals o
join public.statuses s on s.code = o.status
join public.clients c on c.id = o.client_id
join public.devices d on d.id = o.device_id
join public.categories cat on cat.id = d.category_id
join public.brands b on b.id = d.brand_id
left join public.models m on m.id = d.model_id
where o.deleted_at is null;

grant select on public.orders_with_totals, public.order_list to authenticated, service_role;

-- dashboard_stats: + issued_total (виджет «Выдано за всё время»).
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
    'accepted_today', (select count(*) from orders where deleted_at is null and (accepted_at at time zone v_tz)::date = v_today),
    'in_repair', (select count(*) from orders where deleted_at is null and status = 'in_repair'),
    'awaiting_parts', (select count(*) from orders where deleted_at is null and status = 'awaiting_parts'),
    'ready', (select count(*) from orders where deleted_at is null and status = 'ready'),
    'issued_today', (
      select count(distinct h.order_id) from order_status_history h
      where h.to_status = 'issued' and (h.created_at at time zone v_tz)::date = v_today
    ),
    'issued_total', (select count(*) from orders where deleted_at is null and status = 'issued'),
    'revenue_today', (
      select coalesce(sum(t.grand_total), 0) from orders_with_totals t
      where t.deleted_at is null and t.id in (
        select distinct h.order_id from order_status_history h
        where h.to_status = 'issued' and (h.created_at at time zone v_tz)::date = v_today
      )
    ),
    'revenue_total', (select coalesce(sum(t.grand_total), 0) from orders_with_totals t where t.deleted_at is null and t.status = 'issued')
  ) into result;

  return result;
end $$;

-- dashboard_analytics: распределение по статусам + выручка/прибыль по дням.
create or replace function public.dashboard_analytics()
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
  select coalesce(timezone, 'Europe/Moscow') into v_tz from org_settings where id = 1;
  v_today := (now() at time zone v_tz)::date;

  with issued as (
    select t.id, (t.issued_at at time zone v_tz)::date as d, t.grand_total,
      coalesce((
        select sum(oi.cost_price * oi.qty) from order_items oi
        where oi.order_id = t.id and oi.item_type = 'part' and oi.deleted_at is null
      ), 0) as parts_cost
    from orders_with_totals t
    where t.deleted_at is null and t.status = 'issued' and t.issued_at is not null
      and (t.issued_at at time zone v_tz)::date >= v_today - 13
  ),
  days as (select gs::date as d from generate_series(v_today - 13, v_today, interval '1 day') gs)
  select jsonb_build_object(
    'by_status', coalesce((
      select jsonb_agg(jsonb_build_object('code', s.code, 'label', s.label, 'color', s.color, 'count', x.cnt) order by s.sort)
      from (select status, count(*) as cnt from orders where deleted_at is null group by status) x
      join statuses s on s.code = x.status
    ), '[]'::jsonb),
    'revenue_by_day', coalesce((
      select jsonb_agg(jsonb_build_object('date', q.d::text, 'revenue', q.revenue, 'profit', q.profit) order by q.d)
      from (
        select days.d,
          coalesce(sum(i.grand_total), 0) as revenue,
          coalesce(sum(i.grand_total - i.parts_cost), 0) as profit
        from days left join issued i on i.d = days.d
        group by days.d
      ) q
    ), '[]'::jsonb)
  ) into result;

  return result;
end $$;

revoke execute on function public.dashboard_analytics() from public, anon;
grant execute on function public.dashboard_analytics() to authenticated, service_role;
