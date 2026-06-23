-- Бронь товара: имя и телефон того, кто забронировал.
alter table public.stock_items
  add column if not exists reserved_name  text,
  add column if not exists reserved_phone text,
  add column if not exists reserved_at    timestamptz;
