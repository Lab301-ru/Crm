-- ============================================================
-- Финансовый модуль: расходы и прибыльность.
--   Выручка уже считается из выданных заказов (finance_stats).
--   Здесь добавляем РАСХОДЫ с категориями и сводку прибыльности:
--     чистая прибыль = выручка − расходы за период
--     маржинальность = чистая прибыль / выручка × 100%
--
--   Категории расходов: запчасти, зарплаты, аренда, реклама,
--   курьер, аутсорс, цифровые услуги, прочее.
--   Расход можно (опционально) связать с конкретным заказом.
-- ============================================================

create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  category text not null check (category in (
    'parts', 'salary', 'rent', 'ads', 'courier', 'outsource', 'digital', 'other'
  )),
  amount numeric(12, 2) not null check (amount > 0),
  spent_on date not null default current_date,
  description text,
  order_id uuid references public.orders (id),   -- опциональная связь с заказом
  created_by uuid references public.profiles (id),
  deleted_at timestamptz,
  deleted_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_expenses_spent_on on public.expenses (spent_on) where deleted_at is null;
create index idx_expenses_category on public.expenses (category) where deleted_at is null;
create index idx_expenses_order on public.expenses (order_id) where order_id is not null and deleted_at is null;

create trigger trg_expenses_updated_at before update on public.expenses
  for each row execute function public.set_updated_at();
create trigger trg_expenses_audit after insert or update on public.expenses
  for each row execute function public.fn_audit();
create trigger trg_expenses_forbid_delete before delete on public.expenses
  for each row execute function public.fn_forbid_delete();
create trigger trg_expenses_guard_soft_delete before update on public.expenses
  for each row execute function public.fn_guard_soft_delete();

-- ------------------------------------------------------------
-- RLS: финансы — данные менеджера/админа (как revenue в dashboard).
-- Мастер расходы не видит и не правит.
-- ------------------------------------------------------------
alter table public.expenses enable row level security;

create policy expenses_select on public.expenses
  for select to authenticated using (public.is_manager_up());
create policy expenses_insert on public.expenses
  for insert to authenticated with check (public.is_manager_up());
create policy expenses_update on public.expenses
  for update to authenticated using (public.is_manager_up()) with check (public.is_manager_up());

-- ------------------------------------------------------------
-- Сводка прибыльности за период.
--   p_period: 'today' | 'month' | 'year' | 'all'
-- Возвращает выручку, расходы, чистую прибыль, маржинальность и
-- разбивку расходов по категориям. Выручка — по дате выдачи заказа,
-- расходы — по дате расхода (spent_on), всё в таймзоне организации.
-- ------------------------------------------------------------
create or replace function public.finance_overview(p_period text default 'month')
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_tz text;
  v_today date;
  v_from date;
  v_revenue numeric;
  v_expenses numeric;
  v_by_category jsonb;
  v_net numeric;
begin
  if not public.is_manager_up() then
    raise exception 'Доступ запрещён';
  end if;
  if p_period not in ('today', 'month', 'year', 'all') then
    raise exception 'Недопустимый период: %', p_period;
  end if;

  select coalesce(timezone, 'Europe/Moscow') into v_tz from org_settings where id = 1;
  v_tz := coalesce(v_tz, 'Europe/Moscow');
  v_today := (now() at time zone v_tz)::date;
  v_from := case p_period
    when 'today' then v_today
    when 'month' then date_trunc('month', v_today)::date
    when 'year'  then date_trunc('year', v_today)::date
    else date '0001-01-01'
  end;

  -- Выручка: сумма выданных заказов, дата выдачи в окне периода
  with issued as (
    select order_id, max(created_at) as issued_at
    from order_status_history
    where to_status = 'issued'
    group by order_id
  )
  select coalesce(sum(t.grand_total), 0) into v_revenue
  from issued i
  join orders_with_totals t
    on t.id = i.order_id and t.deleted_at is null and t.status = 'issued'
  where (i.issued_at at time zone v_tz)::date >= v_from
    and (i.issued_at at time zone v_tz)::date <= v_today;

  -- Расходы за период
  select coalesce(sum(amount), 0) into v_expenses
  from expenses
  where deleted_at is null and spent_on >= v_from and spent_on <= v_today;

  select coalesce(jsonb_object_agg(category, total), '{}'::jsonb) into v_by_category
  from (
    select category, sum(amount) as total
    from expenses
    where deleted_at is null and spent_on >= v_from and spent_on <= v_today
    group by category
  ) c;

  v_net := v_revenue - v_expenses;

  return jsonb_build_object(
    'period', p_period,
    'revenue', v_revenue,
    'expenses', v_expenses,
    'net_profit', v_net,
    'margin', case when v_revenue > 0 then round(v_net / v_revenue * 100, 1) else 0 end,
    'expenses_by_category', v_by_category
  );
end $$;

revoke execute on function public.finance_overview(text) from public, anon;
grant execute on function public.finance_overview(text) to authenticated, service_role;
