-- ============================================================
-- Модуль «Склад / Продажи»: товарный ассортимент на реализацию
-- (б/у аппараты, платы, запчасти, аксессуары) + учёт продаж с покупателем.
-- Выручка и прибыль продаж включаются в finance_overview.
-- ============================================================

create table if not exists public.stock_items (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  kind text not null default 'other'
    check (kind in ('used_device', 'board', 'part', 'accessory', 'other')),
  description text,
  quantity integer not null default 1 check (quantity >= 0),
  cost_price numeric(12,2) not null default 0 check (cost_price >= 0),
  price numeric(12,2) not null default 0 check (price >= 0),
  status text not null default 'in_stock'
    check (status in ('in_stock', 'reserved', 'sold', 'archived')),
  photo_path text,
  photo_name text,
  supplier text,
  note text,
  created_by uuid references public.profiles (id),
  deleted_at timestamptz,
  deleted_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_stock_items_status on public.stock_items (status) where deleted_at is null;

create table if not exists public.stock_sales (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.stock_items (id),
  qty numeric(10,2) not null default 1 check (qty > 0),
  unit_price numeric(12,2) not null check (unit_price >= 0),
  total numeric(12,2) not null check (total >= 0),
  cost_total numeric(12,2) not null default 0,
  buyer_client_id uuid references public.clients (id),
  buyer_name text,
  sold_by uuid references public.profiles (id),
  sold_at timestamptz not null default now(),
  note text,
  created_at timestamptz not null default now()
);
create index if not exists idx_stock_sales_sold_at on public.stock_sales (sold_at);
create index if not exists idx_stock_sales_item on public.stock_sales (item_id);

do $$ begin
  if not exists (select 1 from pg_trigger where tgname='trg_stock_items_updated_at') then
    create trigger trg_stock_items_updated_at before update on public.stock_items
      for each row execute function public.set_updated_at();
  end if;
  if not exists (select 1 from pg_trigger where tgname='trg_stock_items_audit') then
    create trigger trg_stock_items_audit after insert or update on public.stock_items
      for each row execute function public.fn_audit();
  end if;
  if not exists (select 1 from pg_trigger where tgname='trg_stock_items_forbid_delete') then
    create trigger trg_stock_items_forbid_delete before delete on public.stock_items
      for each row execute function public.fn_forbid_delete();
  end if;
end $$;

alter table public.stock_items enable row level security;
alter table public.stock_sales enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='stock_items' and policyname='stock_items_select') then
    create policy stock_items_select on public.stock_items for select to authenticated using (public.is_active_staff());
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='stock_items' and policyname='stock_items_insert') then
    create policy stock_items_insert on public.stock_items for insert to authenticated with check (public.is_active_staff());
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='stock_items' and policyname='stock_items_update') then
    create policy stock_items_update on public.stock_items for update to authenticated using (public.is_active_staff()) with check (public.is_active_staff());
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='stock_sales' and policyname='stock_sales_select') then
    create policy stock_sales_select on public.stock_sales for select to authenticated using (public.is_manager_up());
  end if;
end $$;

create or replace function public.sell_stock_item(
  p_item_id uuid,
  p_qty numeric default 1,
  p_unit_price numeric default null,
  p_buyer_client_id uuid default null,
  p_buyer_name text default null,
  p_note text default null
)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_item stock_items%rowtype;
  v_price numeric;
  v_sale_id uuid;
begin
  if not public.is_manager_up() then raise exception 'Продажа доступна администратору и менеджеру'; end if;

  select * into v_item from stock_items where id = p_item_id and deleted_at is null for update;
  if not found then raise exception 'Позиция склада не найдена'; end if;
  if p_qty <= 0 then raise exception 'Количество должно быть больше 0'; end if;
  if p_qty > v_item.quantity then raise exception 'На складе только % шт.', v_item.quantity; end if;

  v_price := coalesce(p_unit_price, v_item.price);

  insert into stock_sales (item_id, qty, unit_price, total, cost_total, buyer_client_id, buyer_name, sold_by, note)
  values (p_item_id, p_qty, v_price, v_price * p_qty, v_item.cost_price * p_qty,
          p_buyer_client_id, nullif(btrim(coalesce(p_buyer_name,'')), ''), auth.uid(), p_note)
  returning id into v_sale_id;

  update stock_items
    set quantity = quantity - p_qty,
        status = case when quantity - p_qty <= 0 then 'sold' else status end
    where id = p_item_id;

  return v_sale_id;
end $$;

revoke execute on function public.sell_stock_item(uuid, numeric, numeric, uuid, text, text) from public, anon;
grant  execute on function public.sell_stock_item(uuid, numeric, numeric, uuid, text, text) to authenticated, service_role;

do $do$
begin
  if not exists (select 1 from information_schema.tables where table_schema='storage' and table_name='objects') then return; end if;

  insert into storage.buckets (id, name, public) values ('stock', 'stock', false) on conflict (id) do nothing;

  if not exists (select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='stock_photos_select') then
    execute $pol$ create policy stock_photos_select on storage.objects for select to authenticated using (bucket_id='stock' and public.is_active_staff()) $pol$;
  end if;
  if not exists (select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='stock_photos_insert') then
    execute $pol$ create policy stock_photos_insert on storage.objects for insert to authenticated with check (bucket_id='stock' and public.is_active_staff()) $pol$;
  end if;
  if not exists (select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='stock_photos_delete') then
    execute $pol$ create policy stock_photos_delete on storage.objects for delete to authenticated using (bucket_id='stock' and public.is_manager_up()) $pol$;
  end if;
end $do$;

-- finance_overview v2: + выручка/прибыль продаж со склада.
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

  with issued as (
    select order_id, max(created_at) as issued_at from order_status_history where to_status='issued' group by order_id
  )
  select coalesce(sum(t.grand_total),0) into v_revenue
  from issued i
  join orders_with_totals t on t.id=i.order_id and t.deleted_at is null and t.status='issued'
  where (i.issued_at at time zone v_tz)::date between v_from and v_today;

  select coalesce(sum(amount),0) into v_expenses
  from expenses where deleted_at is null and spent_on between v_from and v_today;

  select coalesce(jsonb_object_agg(category,total),'{}'::jsonb) into v_by_category
  from (select category, sum(amount) total from expenses
        where deleted_at is null and spent_on between v_from and v_today group by category) c;

  select coalesce(sum(total),0), coalesce(sum(cost_total),0)
    into v_stock_revenue, v_stock_cogs
  from stock_sales
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
