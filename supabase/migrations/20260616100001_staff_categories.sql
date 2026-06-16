-- ============================================================
-- Сотрудники могут добавлять новые категории техники (так же, как
-- модели/бренды добавляются на лету при приёмке). Импорт справочника
-- и правка прочих справочников остаются за администратором.
-- ============================================================

drop policy if exists categories_write_insert on public.categories;
create policy categories_write_insert on public.categories
  for insert to authenticated with check (public.is_active_staff());
