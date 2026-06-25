-- 1) Переименование статусов (коды не меняются).
update public.statuses set label = 'Выдан с ремонтом'  where code = 'issued';
update public.statuses set label = 'Выдан без ремонта' where code = 'declined';

-- 2) status_since — дата/время входа заказа в его текущий статус
--    (последний переход в order_status_history к текущему статусу).
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
   and o.status not in ('ready', 'issued', 'declined', 'scrapped')) as is_overdue,
  (select max(h.created_at) from public.order_status_history h
     where h.order_id = o.id and h.to_status = o.status) as status_since
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
  o.accepted_at, o.due_date, o.is_overdue, o.status_since,
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
