-- ============================================================
-- Период «сегодня/месяц/год» в finance_stats теперь ограничен сверху.
-- Иначе заказы с датой выдачи в БУДУЩЕМ (issued_at вперёд) попадали в
-- «сегодня» и завышали сумму (например, 9300 вместо 6000).
-- ============================================================
create or replace function public.finance_stats()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  tz text;
  n timestamp;       -- «сейчас» как локальное время организации
  v jsonb;
begin
  if not public.is_active_staff() then
    raise exception 'Доступ запрещён';
  end if;
  select coalesce(timezone, 'Europe/Moscow') into tz from org_settings where id = 1;
  tz := coalesce(tz, 'Europe/Moscow');
  n := now() at time zone tz;

  with issued as (
    select (t.issued_at at time zone tz) as ia, t.grand_total,
      coalesce((
        select sum(oi.cost_price * oi.qty) from order_items oi
        where oi.order_id = t.id and oi.item_type = 'part' and oi.deleted_at is null
      ), 0) as parts_cost
    from orders_with_totals t
    where t.deleted_at is null and t.status = 'issued' and t.issued_at is not null
  ),
  agg as (
    select
      coalesce(sum(grand_total) filter (where ia >= date_trunc('day',   n) and ia < date_trunc('day',   n) + interval '1 day'),   0) as rev_today,
      coalesce(sum(grand_total) filter (where ia >= date_trunc('month', n) and ia < date_trunc('month', n) + interval '1 month'), 0) as rev_month,
      coalesce(sum(grand_total) filter (where ia >= date_trunc('year',  n) and ia < date_trunc('year',  n) + interval '1 year'),  0) as rev_year,
      coalesce(sum(grand_total), 0) as rev_all,
      coalesce(sum(grand_total - parts_cost) filter (where ia >= date_trunc('day',   n) and ia < date_trunc('day',   n) + interval '1 day'),   0) as prof_today,
      coalesce(sum(grand_total - parts_cost) filter (where ia >= date_trunc('month', n) and ia < date_trunc('month', n) + interval '1 month'), 0) as prof_month,
      coalesce(sum(grand_total - parts_cost) filter (where ia >= date_trunc('year',  n) and ia < date_trunc('year',  n) + interval '1 year'),  0) as prof_year,
      coalesce(sum(grand_total - parts_cost), 0) as prof_all
    from issued
  )
  select jsonb_build_object(
    'revenue', jsonb_build_object('today', rev_today, 'month', rev_month, 'year', rev_year, 'all', rev_all),
    'profit',  jsonb_build_object('today', prof_today, 'month', prof_month, 'year', prof_year, 'all', prof_all)
  ) into v from agg;

  return v;
end $$;
