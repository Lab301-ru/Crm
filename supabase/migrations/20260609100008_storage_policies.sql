-- =============================================================
-- ЭТАП 10. Хранилище файлов: бакеты и политики Storage
-- =============================================================
-- Оба бакета приватные: доступ к файлам — только через RLS
-- (видимость заказа) и signed URL, которые выдаёт клиентский SDK.
-- Путь файла: '<order_id>/<имя>' — первый сегмент связывает объект
-- с заказом, а подзапрос к orders сам применяет RLS заказов
-- (мастер видит фото только своих заказов).

-- order_id из пути вида '<order_id>/<файл>'; некорректный путь -> null
create or replace function public.path_order_id(p_name text)
returns uuid
language plpgsql
immutable
as $$
begin
  return split_part(p_name, '/', 1)::uuid;
exception when others then
  return null;
end $$;

revoke execute on function public.path_order_id(text) from public;
grant execute on function public.path_order_id(text) to authenticated, service_role;

-- На чистом PostgreSQL (локальный RLS-тест) схемы storage нет —
-- блок выполняется условно и не ломает прогон миграций.
do $do$
begin
  if not exists (
    select 1 from information_schema.tables
    where table_schema = 'storage' and table_name = 'buckets'
  ) then
    raise notice 'storage schema отсутствует — политики Storage пропущены (локальный тест)';
    return;
  end if;

  -- Бакеты (идемпотентно)
  insert into storage.buckets (id, name, public)
  values ('device-photos', 'device-photos', false),
         ('documents', 'documents', false)
  on conflict (id) do nothing;

  -- ------------------------------------------------------------
  -- device-photos: чтение/загрузка через видимость заказа;
  -- физическое удаление — менеджер/админ (в UI это soft delete
  -- в attachments, прямое удаление объекта — для обслуживания)
  -- ------------------------------------------------------------
  execute $pol$
    create policy storage_photos_select on storage.objects
      for select to authenticated using (
        bucket_id = 'device-photos'
        and exists (select 1 from public.orders o where o.id = public.path_order_id(name))
      )
  $pol$;

  execute $pol$
    create policy storage_photos_insert on storage.objects
      for insert to authenticated with check (
        bucket_id = 'device-photos'
        and public.is_active_staff()
        and exists (select 1 from public.orders o where o.id = public.path_order_id(name))
      )
  $pol$;

  execute $pol$
    create policy storage_photos_delete on storage.objects
      for delete to authenticated using (
        bucket_id = 'device-photos' and public.is_manager_up()
      )
  $pol$;

  -- ------------------------------------------------------------
  -- documents: PDF генерирует Edge Function (service_role, мимо RLS);
  -- сотрудники только читают через видимость заказа, чистит админ
  -- ------------------------------------------------------------
  execute $pol$
    create policy storage_docs_select on storage.objects
      for select to authenticated using (
        bucket_id = 'documents'
        and exists (select 1 from public.orders o where o.id = public.path_order_id(name))
      )
  $pol$;

  execute $pol$
    create policy storage_docs_delete on storage.objects
      for delete to authenticated using (
        bucket_id = 'documents' and public.is_admin()
      )
  $pol$;
end $do$;
