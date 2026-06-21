-- ============================================================
-- Модуль «Аналитика»: метрики по выданным заказам.
--   • Топ-10 популярных ремонтов (по строкам работ выданных заказов)
--   • Средний чек / максимальный чек
--   • Топ-10 клиентов по сумме оплат
--   • Фильтр по времени: 'all' (всё время) | 'month' (текущий месяц)
--
-- «Оплата» = grand_total выданного заказа (переход в 'issued').
-- Дата заказа для фильтра — дата выдачи, считается в таймзоне
-- организации, как в finance_stats.
-- ============================================================

create or replace function public.analytics_stats(p_period text default 'all')
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_tz text;
  v_today date;
  v_month date;
  result jsonb;
begin
  if not public.is_active_staff() then
    raise exception 'Доступ запрещён';
  end if;
  if p_period not in ('all', 'month') then
    raise exception 'Недопустимый период: %', p_period;
  end if;

  select coalesce(timezone, 'Europe/Moscow') into v_tz from org_settings where id = 1;
  v_tz := coalesce(v_tz, 'Europe/Moscow');
  v_today := (now() at time zone v_tz)::date;
  v_month := date_trunc('month', v_today)::date;

  with issued as (
    select order_id, max(created_at) as issued_at
    from order_status_history
    where to_status = 'issued'
    group by order_id
  ),
  scope as (
    select t.id as order_id, t.client_id, t.grand_total
    from issued i
    join orders_with_totals t
      on t.id = i.order_id and t.deleted_at is null and t.status = 'issued'
    where p_period = 'all' or (i.issued_at at time zone v_tz)::date >= v_month
  ),
  repairs as (
    select oi.name,
           count(*) as cnt,
           coalesce(sum(oi.price * oi.qty), 0) as sum_price
    from order_items oi
    join scope s on s.order_id = oi.order_id
    where oi.item_type = 'work' and oi.deleted_at is null
    group by oi.name
    order by cnt desc, sum_price desc
    limit 10
  ),
  clients_top as (
    select c.id, c.name, c.phone_display, c.phone,
           count(*) as orders_count,
           coalesce(sum(s.grand_total), 0) as total
    from scope s
    join clients c on c.id = s.client_id
    group by c.id, c.name, c.phone_display, c.phone
    order by total desc, orders_count desc
    limit 10
  )
  select jsonb_build_object(
    'period', p_period,
    'orders_count', (select count(*) from scope),
    'revenue', (select coalesce(sum(grand_total), 0) from scope),
    'avg_check', (select coalesce(round(avg(grand_total), 2), 0) from scope),
    'max_check', (select coalesce(max(grand_total), 0) from scope),
    'top_repairs', coalesce((
      select jsonb_agg(jsonb_build_object('name', name, 'count', cnt, 'sum', sum_price))
      from repairs
    ), '[]'::jsonb),
    'top_clients', coalesce((
      select jsonb_agg(jsonb_build_object(
        'client_id', id, 'name', name,
        'phone', coalesce(phone_display, phone),
        'orders_count', orders_count, 'total', total))
      from clients_top
    ), '[]'::jsonb)
  ) into result;

  return result;
end $$;

revoke execute on function public.analytics_stats(text) from public, anon;
grant execute on function public.analytics_stats(text) to authenticated, service_role;
