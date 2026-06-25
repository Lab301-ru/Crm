-- ============================================================
-- Multi-device заказы, этап 1 (схема + бэкенд). Аддитивно; бэкфилл 1:1.
-- Один заказ → несколько аппаратов (order_devices). У каждого аппарата
-- свои работы/запчасти (order_items.order_device_id) и своя выдача
-- (outcome/issued_at). Заказ закрывается ('issued'), когда все аппараты
-- отданы. Ремонтный статус остаётся на уровне заказа (orders.status).
-- ============================================================

create table if not exists public.order_devices (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id),
  device_id uuid not null references public.devices (id),
  position integer not null default 1,
  claimed_defect text,
  diagnostic_result text,
  master_comment text,
  warranty_days integer,
  outcome text check (outcome in ('issued', 'returned')),
  issued_at timestamptz,
  issued_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  deleted_by uuid references public.profiles (id)
);
create index if not exists idx_order_devices_order on public.order_devices (order_id) where deleted_at is null;

alter table public.order_items
  add column if not exists order_device_id uuid references public.order_devices (id);
create index if not exists idx_order_items_device on public.order_items (order_device_id) where deleted_at is null;

insert into public.order_devices (order_id, device_id, position, claimed_defect,
  diagnostic_result, master_comment, warranty_days, outcome, issued_at)
select o.id, o.device_id, 1, o.claimed_defect, o.diagnostic_result, o.master_comment,
       o.warranty_days,
       case when o.status = 'issued' then 'issued' end,
       case when o.status = 'issued'
            then (select max(h.created_at) from order_status_history h
                  where h.order_id = o.id and h.to_status = 'issued') end
from public.orders o
where not exists (select 1 from public.order_devices od where od.order_id = o.id);

alter table public.order_items disable trigger trg_order_items_lock;
update public.order_items i
set order_device_id = od.id
from public.order_devices od
where od.order_id = i.order_id and i.order_device_id is null;
alter table public.order_items enable trigger trg_order_items_lock;

do $$ begin
  if not exists (select 1 from pg_trigger where tgname='trg_order_devices_updated_at') then
    create trigger trg_order_devices_updated_at before update on public.order_devices
      for each row execute function public.set_updated_at();
  end if;
  if not exists (select 1 from pg_trigger where tgname='trg_order_devices_audit') then
    create trigger trg_order_devices_audit after insert or update on public.order_devices
      for each row execute function public.fn_audit();
  end if;
  if not exists (select 1 from pg_trigger where tgname='trg_order_devices_forbid_delete') then
    create trigger trg_order_devices_forbid_delete before delete on public.order_devices
      for each row execute function public.fn_forbid_delete();
  end if;
end $$;

alter table public.order_devices enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='order_devices' and policyname='order_devices_select') then
    create policy order_devices_select on public.order_devices for select to authenticated using (public.is_active_staff());
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='order_devices' and policyname='order_devices_insert') then
    create policy order_devices_insert on public.order_devices for insert to authenticated with check (public.is_active_staff());
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='order_devices' and policyname='order_devices_update') then
    create policy order_devices_update on public.order_devices for update to authenticated using (public.is_active_staff()) with check (public.is_active_staff());
  end if;
end $$;

drop view if exists public.order_device_totals;
create view public.order_device_totals
with (security_invoker = true) as
select
  od.id, od.order_id, od.device_id, od.position, od.claimed_defect,
  od.diagnostic_result, od.master_comment, od.warranty_days,
  od.outcome, od.issued_at, od.issued_by, od.created_at,
  cat.name as category_name, b.name as brand_name, m.name as model_name,
  concat_ws(' ', cat.name, b.name, coalesce(m.name, '')) as device_label,
  d.serial_number,
  coalesce(t.works_total, 0) as works_total,
  coalesce(t.parts_total, 0) as parts_total,
  coalesce(t.works_total, 0) + coalesce(t.parts_total, 0) as grand_total
from public.order_devices od
join public.devices d on d.id = od.device_id
join public.categories cat on cat.id = d.category_id
join public.brands b on b.id = d.brand_id
left join public.models m on m.id = d.model_id
left join lateral (
  select
    coalesce(sum(i.price * i.qty) filter (where i.item_type = 'work'), 0)::numeric(12,2) as works_total,
    coalesce(sum(i.price * i.qty) filter (where i.item_type = 'part'), 0)::numeric(12,2) as parts_total
  from public.order_items i
  where i.order_device_id = od.id and i.deleted_at is null
) t on true
where od.deleted_at is null;

grant select on public.order_device_totals to authenticated, service_role;
