-- ============================================================
-- Задача 1: маржа на запчастях и агрегаты выручки/прибыли.
--   • order_items.cost_price — закупочная цена за единицу (для работ = 0);
--   • finance_stats() — выручка и чистая прибыль за сегодня/месяц/год/всё
--     время, считается в БД по дате выдачи (переход в 'issued'),
--     с учётом таймзоны из org_settings.
-- Доступ — любому активному сотруднику (ограничения мастера сняты,
-- см. миграцию ..._roles).
-- ============================================================

alter table public.order_items
  add column if not exists cost_price numeric not null default 0 check (cost_price >= 0);

create or replace function public.finance_stats()
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
  v_year date;
  result jsonb;
begin
  if not public.is_active_staff() then
    raise exception 'Доступ запрещён';
  end if;

  select coalesce(timezone, 'Europe/Moscow') into v_tz from org_settings where id = 1;
  v_tz := coalesce(v_tz, 'Europe/Moscow');
  v_today := (now() at time zone v_tz)::date;
  v_month := date_trunc('month', v_today)::date;
  v_year  := date_trunc('year',  v_today)::date;

  with issued as (
    select order_id, max(created_at) as issued_at
    from order_status_history
    where to_status = 'issued'
    group by order_id
  ),
  po as (
    select
      (i.issued_at at time zone v_tz)::date as d,
      t.grand_total,
      coalesce((
        select sum(oi.cost_price * oi.qty)
        from order_items oi
        where oi.order_id = i.order_id
          and oi.item_type = 'part'
          and oi.deleted_at is null
      ), 0) as parts_cost
    from issued i
    join orders_with_totals t
      on t.id = i.order_id and t.deleted_at is null and t.status = 'issued'
  )
  select jsonb_build_object(
    'revenue', jsonb_build_object(
      'today', coalesce(sum(grand_total) filter (where d = v_today), 0),
      'month', coalesce(sum(grand_total) filter (where d >= v_month), 0),
      'year',  coalesce(sum(grand_total) filter (where d >= v_year), 0),
      'all',   coalesce(sum(grand_total), 0)
    ),
    'profit', jsonb_build_object(
      'today', coalesce(sum(grand_total - parts_cost) filter (where d = v_today), 0),
      'month', coalesce(sum(grand_total - parts_cost) filter (where d >= v_month), 0),
      'year',  coalesce(sum(grand_total - parts_cost) filter (where d >= v_year), 0),
      'all',   coalesce(sum(grand_total - parts_cost), 0)
    )
  ) into result
  from po;

  return result;
end $$;

revoke execute on function public.finance_stats() from public, anon;
grant execute on function public.finance_stats() to authenticated, service_role;
