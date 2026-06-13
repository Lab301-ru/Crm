-- ============================================================
-- Миграция: починка доступа к справочникам и настройкам + быстрый
-- бренд. Закрывает баги боевого проекта RemCity36 (ultraCRM):
--   • categories/brands/models возвращали 403 (нет GRANT SELECT
--     для роли authenticated и/или чтение было завязано на профиль);
--   • org_settings?id=eq.1 возвращал 406 — строки не было, потому
--     что `supabase db push` применяет миграции, но НЕ seed.sql;
--   • в форме приёмки нельзя было задать бренд без модели.
--
-- Решение: справочники и настройки — НЕсекретные данные (каталог
-- устройств, реквизиты СЦ печатаются на квитанции и видны на
-- публичной странице). Делаем их читаемыми любому авторизованному
-- сотруднику: явный GRANT + политика SELECT using(true). Записи
-- по-прежнему только у админа (политики insert/update из миграции 6).
-- ============================================================

-- ------------------------------------------------------------
-- 1. Гранты: 403 на categories — это отсутствие GRANT, а не RLS
--    (RLS-отказ вернул бы пустой список, а не 403). Выдаём явно.
-- ------------------------------------------------------------
grant usage on schema public to authenticated, anon;
grant select on
  public.categories, public.brands, public.models,
  public.field_templates, public.statuses, public.status_transitions,
  public.org_settings
to authenticated;

-- ------------------------------------------------------------
-- 2. Политики SELECT для справочников и настроек: любому
--    авторизованному сотруднику, без зависимости от строки profiles
--    (раньше using(is_active_staff()) ломалось при рассинхроне
--    профиля/JWT и давало пустой каталог).
-- ------------------------------------------------------------
drop policy if exists categories_select on public.categories;
create policy categories_select on public.categories
  for select to authenticated using (true);

drop policy if exists brands_select on public.brands;
create policy brands_select on public.brands
  for select to authenticated using (true);

drop policy if exists models_select on public.models;
create policy models_select on public.models
  for select to authenticated using (true);

drop policy if exists field_templates_select on public.field_templates;
create policy field_templates_select on public.field_templates
  for select to authenticated using (true);

drop policy if exists statuses_select on public.statuses;
create policy statuses_select on public.statuses
  for select to authenticated using (true);

drop policy if exists transitions_select on public.status_transitions;
create policy transitions_select on public.status_transitions
  for select to authenticated using (true);

drop policy if exists org_settings_select on public.org_settings;
create policy org_settings_select on public.org_settings
  for select to authenticated using (true);

-- ------------------------------------------------------------
-- 3. Гарантируем строку org_settings id=1 на самом `db push`
--    (seed.sql при db push не запускается). Идемпотентно —
--    не перетирает настройки, заданные админом в интерфейсе.
-- ------------------------------------------------------------
insert into public.org_settings (id, name, order_prefix, default_warranty_days, receipt_disclaimer)
values (
  1,
  'Сервисный центр',
  'L',
  30,
  'Сервисный центр не несёт ответственности за данные, оставленные на устройстве. Невостребованное оборудование хранится 60 дней.'
)
on conflict (id) do nothing;

-- ------------------------------------------------------------
-- 4. Быстрое добавление БРЕНДА без модели (для формы приёмки):
--    мастер/менеджер ввёл бренд, которого нет в справочнике —
--    создаём его на лету, не требуя модель. Зеркало quick_add_model,
--    идемпотентно по name_normalized.
-- ------------------------------------------------------------
create or replace function public.quick_add_brand(p_brand text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_brand_id uuid;
begin
  if not public.is_manager_up() then
    raise exception 'Доступ запрещён';
  end if;
  if btrim(coalesce(p_brand, '')) = '' then
    raise exception 'Бренд обязателен';
  end if;

  insert into brands (name) values (btrim(p_brand))
  on conflict (name_normalized) do update set name = brands.name
  returning id into v_brand_id;

  return jsonb_build_object('brand_id', v_brand_id);
end $$;

revoke execute on function public.quick_add_brand(text) from public, anon;
grant execute on function public.quick_add_brand(text) to authenticated, service_role;
