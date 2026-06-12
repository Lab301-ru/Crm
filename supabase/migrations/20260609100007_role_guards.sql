-- ============================================================
-- Миграция 7: колоночные ограничения ролей (Этап 9)
-- RLS отвечает за «какие строки», эти триггеры — за «какие поля»:
--  - системные ссылки заказа неизменяемы ни для кого, кроме админа;
--  - мастер (диагностика и ремонт) не трогает финансы и назначения;
--  - мастер не меняет категорию/бренд/модель устройства.
-- ============================================================

create or replace function public.fn_guard_order_columns()
returns trigger
language plpgsql
as $$
begin
  if (new.client_id, new.device_id, new.number, new.display_number, new.qr_token)
     is distinct from
     (old.client_id, old.device_id, old.number, old.display_number, old.qr_token)
     and public.app_role() <> 'admin' then
    raise exception 'Системные поля заказа (клиент, устройство, номер, токен) неизменяемы';
  end if;

  if public.app_role() = 'master'
     and (new.prepayment, new.payment_status, new.payment_method,
          new.manager_id, new.master_id, new.warranty_days,
          new.claimed_defect, new.accepted_at, new.linked_order_id)
         is distinct from
         (old.prepayment, old.payment_status, old.payment_method,
          old.manager_id, old.master_id, old.warranty_days,
          old.claimed_defect, old.accepted_at, old.linked_order_id) then
    raise exception 'Мастеру доступны: диагностика, комментарии, срок готовности и смена статуса';
  end if;

  return new;
end $$;

create trigger trg_orders_guard_columns before update on public.orders
  for each row execute function public.fn_guard_order_columns();

create or replace function public.fn_guard_device_columns()
returns trigger
language plpgsql
as $$
begin
  if public.app_role() = 'master'
     and (new.category_id, new.brand_id, new.model_id)
         is distinct from
         (old.category_id, old.brand_id, old.model_id) then
    raise exception 'Мастер не меняет категорию, бренд и модель устройства';
  end if;
  return new;
end $$;

create trigger trg_devices_guard_columns before update on public.devices
  for each row execute function public.fn_guard_device_columns();
