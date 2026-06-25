-- В списке заказов: количество аппаратов и склейка названий всех аппаратов,
-- чтобы было видно мульти-заказ и все устройства, а не только первое.
drop view if exists public.order_list;

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
  o.issued_at,
  coalesce(dev.device_count, 1) as device_count,
  coalesce(dev.devices_label, concat_ws(' ', cat.name, b.name, coalesce(m.name, ''))) as devices_label
from public.orders_with_totals o
join public.statuses s on s.code = o.status
join public.clients c on c.id = o.client_id
join public.devices d on d.id = o.device_id
join public.categories cat on cat.id = d.category_id
join public.brands b on b.id = d.brand_id
left join public.models m on m.id = d.model_id
left join lateral (
  select
    count(*) as device_count,
    string_agg(concat_ws(' ', cat2.name, b2.name, coalesce(m2.name, '')), ', ' order by od.position) as devices_label
  from public.order_devices od
  join public.devices d2 on d2.id = od.device_id
  join public.categories cat2 on cat2.id = d2.category_id
  join public.brands b2 on b2.id = d2.brand_id
  left join public.models m2 on m2.id = d2.model_id
  where od.order_id = o.id and od.deleted_at is null
) dev on true
where o.deleted_at is null;

grant select on public.order_list to authenticated, service_role;
