-- Внешние сервисы (ссылки из настроек):
--   website_admin_url — админка сайта,
--   cctv_url          — видеонаблюдение,
--   telephony_url     — телефония (звонки/записи).
alter table public.org_settings
  add column if not exists website_admin_url text,
  add column if not exists cctv_url          text,
  add column if not exists telephony_url     text;
