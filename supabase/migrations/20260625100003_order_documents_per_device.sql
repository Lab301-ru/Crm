-- Квитанция/акт по конкретному аппарату: привязка документа к order_devices.
alter table public.order_documents
  add column if not exists order_device_id uuid references public.order_devices (id);
