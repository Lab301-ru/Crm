-- Журнал платежей для UI: платёж + номер заказа + клиент.
-- Показывает, из чего сложилась выручка периода (предоплаты и оплаты при выдаче).
drop view if exists public.payment_list;

create view public.payment_list
with (security_invoker = true)
as
select
  p.id, p.order_id, p.amount, p.kind, p.method, p.paid_at,
  o.display_number, o.status as order_status,
  c.name as client_name
from public.order_payments p
join public.orders o on o.id = p.order_id and o.deleted_at is null
join public.clients c on c.id = o.client_id;

grant select on public.payment_list to authenticated, service_role;
