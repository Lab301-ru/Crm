-- ============================================================
-- Аналитика: период «Год» + помесячный временной ряд для графика.
--   • analytics_stats(p_period) — добавлен 'year' (всё время/месяц/год).
--   • analytics_series(p_months) — точки по месяцам за последние N
--     месяцев: выручка, чистая прибыль (= выручка − закупка запчастей),
--     количество заказов, средний чек. Для линейного графика по всем
--     показателям на странице «Аналитика».
-- ============================================================

create or replace function public.analytics_stats(p_period text default 'all')
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_tz text; v_today date; v_from date; result jsonb;
begin
  if not public.is_active_staff() then raise exception 'Доступ запрещён'; end if;
  if p_period not in ('all', 'month', 'year') then raise exception 'Недопустимый период: %', p_period; end if;

  select coalesce(timezone, 'Europe/Moscow') into v_tz from org_settings where id = 1;
  v_tz := coalesce(v_tz, 'Europe/Moscow');
  v_today := (now() at time zone v_tz)::date;
  v_from := case p_period
    when 'month' then date_trunc('month', v_today)::date
    when 'year'  then date_trunc('year', v_today)::date
    else date '0001-01-01'
  end;

  with issued as (
    select order_id, max(created_at) as issued_at
    from order_status_history where to_status = 'issued' group by order_id
  ),
  scope as (
    select t.id as order_id, t.client_id, t.grand_total
    from issued i
    join orders_with_totals t on t.id = i.order_id and t.deleted_at is null and t.status = 'issued'
    where (i.issued_at at time zone v_tz)::date >= v_from
  ),
  repairs as (
    select oi.name, count(*) as cnt, coalesce(sum(oi.price * oi.qty), 0) as sum_price
    from order_items oi
    join scope s on s.order_id = oi.order_id
    where oi.item_type = 'work' and oi.deleted_at is null
    group by oi.name order by cnt desc, sum_price desc limit 10
  ),
  clients_top as (
    select c.id, c.name, c.phone_display, c.phone,
           count(*) as orders_count, coalesce(sum(s.grand_total), 0) as total
    from scope s join clients c on c.id = s.client_id
    group by c.id, c.name, c.phone_display, c.phone
    order by total desc, orders_count desc limit 10
  )
  select jsonb_build_object(
    'period', p_period,
    'orders_count', (select count(*) from scope),
    'revenue', (select coalesce(sum(grand_total), 0) from scope),
    'avg_check', (select coalesce(round(avg(grand_total), 2), 0) from scope),
    'max_check', (select coalesce(max(grand_total), 0) from scope),
    'top_repairs', coalesce((select jsonb_agg(jsonb_build_object('name', name, 'count', cnt, 'sum', sum_price)) from repairs), '[]'::jsonb),
    'top_clients', coalesce((select jsonb_agg(jsonb_build_object(
        'client_id', id, 'name', name, 'phone', coalesce(phone_display, phone),
        'orders_count', orders_count, 'total', total)) from clients_top), '[]'::jsonb)
  ) into result;
  return result;
end $$;

revoke execute on function public.analytics_stats(text) from public, anon;
grant  execute on function public.analytics_stats(text) to authenticated, service_role;

create or replace function public.analytics_series(p_months int default 12)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_tz text; v_today date; v_first date; result jsonb;
begin
  if not public.is_active_staff() then raise exception 'Доступ запрещён'; end if;
  p_months := greatest(1, least(coalesce(p_months, 12), 36));

  select coalesce(timezone, 'Europe/Moscow') into v_tz from org_settings where id = 1;
  v_tz := coalesce(v_tz, 'Europe/Moscow');
  v_today := (now() at time zone v_tz)::date;
  v_first := (date_trunc('month', v_today) - ((p_months - 1) || ' months')::interval)::date;

  with issued as (
    select date_trunc('month', (t.issued_at at time zone v_tz)::date)::date as m,
      t.grand_total,
      coalesce((
        select sum(oi.cost_price * oi.qty) from order_items oi
        where oi.order_id = t.id and oi.item_type = 'part' and oi.deleted_at is null
      ), 0) as parts_cost
    from orders_with_totals t
    where t.deleted_at is null and t.status = 'issued' and t.issued_at is not null
      and (t.issued_at at time zone v_tz)::date >= v_first
  ),
  months as (
    select gs::date as m
    from generate_series(v_first, date_trunc('month', v_today)::date, interval '1 month') gs
  ),
  agg as (
    select m, sum(grand_total) as revenue, sum(grand_total - parts_cost) as profit,
           count(*) as cnt, round(avg(grand_total), 2) as avg_check
    from issued group by m
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'month', to_char(mo.m, 'YYYY-MM'),
    'revenue', coalesce(a.revenue, 0),
    'profit', coalesce(a.profit, 0),
    'orders_count', coalesce(a.cnt, 0),
    'avg_check', coalesce(a.avg_check, 0)
  ) order by mo.m), '[]'::jsonb)
  from months mo left join agg a on a.m = mo.m
  into result;

  return result;
end $$;

revoke execute on function public.analytics_series(int) from public, anon;
grant  execute on function public.analytics_series(int) to authenticated, service_role;
