-- Раздел «Оплата»: ссылка оплаты (Т-Банк) + реквизиты СБП.
alter table public.org_settings
  add column if not exists payment_link_url text default 'https://www.tinkoff.ru/rm/r_rBdRxFbmge.kJtBBjrvLh/vaVYo35413',
  add column if not exists sbp_phone text default '+79996708772',
  add column if not exists sbp_name  text default 'Юрий Б.',
  add column if not exists sbp_bank  text default 'Т-Банк';
