-- ============================================================
-- Доступ сотрудников к вкладкам «Поля устройств» и «Уведомления».
-- Сотрудники (manager + master) получают полный доступ к CRM, кроме
-- вкладок «Организация» (org_settings) и «Сотрудники» (admin-users) —
-- те остаются за администратором. Чтобы две разрешённые вкладки реально
-- работали (а не падали на сохранении из-за RLS), открываем записи:
--   notification_rules — обновление шаблонов/тумблеров;
--   field_templates    — создание и правка доп-полей устройств.
-- org_settings и создание сотрудников НЕ трогаем — остаются admin-only.
-- ============================================================

drop policy if exists rules_update on public.notification_rules;
create policy rules_update on public.notification_rules
  for update to authenticated using (public.is_active_staff()) with check (public.is_active_staff());

drop policy if exists field_templates_insert on public.field_templates;
create policy field_templates_insert on public.field_templates
  for insert to authenticated with check (public.is_active_staff());

drop policy if exists field_templates_update on public.field_templates;
create policy field_templates_update on public.field_templates
  for update to authenticated using (public.is_active_staff()) with check (public.is_active_staff());
