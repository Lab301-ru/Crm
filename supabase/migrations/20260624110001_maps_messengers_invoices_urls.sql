-- Ещё внешние сервисы (ссылки из настроек):
--   Карты:       map_2gis_url, map_yandex_url
--   Мессенджеры: messenger_telegram_url, messenger_whatsapp_url
--   Счёт онлайн: invoice_schet_url / invoice_akt_url / invoice_kp_url
--   (для счетов — готовые формы service-online.su как значения по умолчанию)
alter table public.org_settings
  add column if not exists map_2gis_url            text,
  add column if not exists map_yandex_url          text,
  add column if not exists messenger_telegram_url  text,
  add column if not exists messenger_whatsapp_url  text,
  add column if not exists invoice_schet_url text default 'https://service-online.su/forms/buh/schet/',
  add column if not exists invoice_akt_url   text default 'https://service-online.su/forms/buh/akt_vyipolnennyih_rabot/',
  add column if not exists invoice_kp_url    text default 'https://service-online.su/forms/buh/kp/';
