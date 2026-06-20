-- ============================================================
-- Дашборд: выручка/прибыль по дням за ВЫБРАННЫЙ месяц.
--   • dashboard_revenue_by_month(p_month) — заменяет фиксированные
--     «14 дней» на помесячный график с выбором месяца на клиенте;
--   • p_month — любой день месяца ('YYYY-MM-DD'); null = текущий месяц
--     в таймзоне организации;
--   • логика выручки/прибыли та же, что в dashboard_analytics
--     (выдача по issued_at, прибыль = выручка − закупка запчастей).
-- ============================================================

create or replace function public.dashboard_revenue_by_month(p_month text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_tz text;
  v_first date;
  v_last date;
  result jsonb;
begin
  if not public.is_active_staff() then
    raise exception 'Доступ запрещён';
  end if;

  select coalesce(timezone, 'Europe/Moscow') into v_tz from org_settings where id = 1;
  v_tz := coalesce(v_tz, 'Europe/Moscow');

  -- первый день выбранного месяца (или текущего, если не передан)
  v_first := date_trunc('month',
    coalesce(nullif(p_month, '')::date, (now() at time zone v_tz)::date))::date;
  v_last := (v_first + interval '1 month' - interval '1 day')::date;

  with issued as (
    select t.id,
      (t.issued_at at time zone v_tz)::date as d,
      t.grand_total,
      coalesce((
        select sum(oi.cost_price * oi.qty) from order_items oi
        where oi.order_id = t.id and oi.item_type = 'part' and oi.deleted_at is null
      ), 0) as parts_cost
    from orders_with_totals t
    where t.deleted_at is null and t.status = 'issued' and t.issued_at is not null
      and (t.issued_at at time zone v_tz)::date between v_first and v_last
  ),
  days as (select gs::date as d from generate_series(v_first, v_last, interval '1 day') gs)
  select jsonb_build_object(
    'month', to_char(v_first, 'YYYY-MM'),
    'revenue_total', coalesce((select sum(grand_total) from issued), 0),
    'profit_total', coalesce((select sum(grand_total - parts_cost) from issued), 0),
    'days', coalesce((
      select jsonb_agg(
        jsonb_build_object('date', q.d::text, 'revenue', q.revenue, 'profit', q.profit)
        order by q.d)
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

revoke execute on function public.dashboard_revenue_by_month(text) from public, anon;
grant execute on function public.dashboard_revenue_by_month(text) to authenticated, service_role;
