-- ============================================================
-- Миграция 1: расширения и базовые helper-функции
-- ============================================================

create extension if not exists pg_trgm;
create extension if not exists pgcrypto;

-- pg_cron / pg_net есть в Supabase (Cloud и local); на «голом» Postgres
-- их отсутствие не должно ронять миграцию — уведомления тогда доставляет
-- только прямой вызов Edge Function.
do $$
begin
  create extension if not exists pg_cron;
exception when others then
  raise notice 'pg_cron недоступен: %', sqlerrm;
end $$;

do $$
begin
  create extension if not exists pg_net;
exception when others then
  raise notice 'pg_net недоступен: %', sqlerrm;
end $$;

-- ------------------------------------------------------------
-- Нормализация телефона к E.164 (российские номера: 8XXX → +7XXX)
-- ------------------------------------------------------------
create or replace function public.normalize_phone(p text)
returns text
language sql
immutable
as $$
  select case
    when d = '' then null
    when length(d) = 11 and left(d, 1) = '8' then '+7' || substr(d, 2)
    when length(d) = 11 and left(d, 1) = '7' then '+' || d
    when length(d) = 10 and left(d, 1) = '9' then '+7' || d
    else '+' || d
  end
  from (select regexp_replace(coalesce(p, ''), '\D', '', 'g') as d) t;
$$;

-- ------------------------------------------------------------
-- updated_at: единый триггер для всех таблиц
-- ------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ------------------------------------------------------------
-- Роль из JWT (app_metadata.role) — без обращения к таблицам
-- ------------------------------------------------------------
create or replace function public.app_role()
returns text
language sql
stable
as $$
  select coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '');
$$;
