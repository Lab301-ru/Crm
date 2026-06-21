-- ============================================================
-- Модуль «Запчасти»: закупочный трекинг по заказу.
--   order_parts — отдельная сущность от order_items: order_items
--   фиксирует ЧТО продано клиенту (работа/запчасть в чеке), а
--   order_parts ведёт ЗАКУПКУ детали (где заказать, статус доставки,
--   квитанция поставщика). Один заказ → много позиций запчастей.
--
--   Статусы закупки:
--     need_order — нужно заказать
--     ordered    — заказано / ожидаем
--     received   — получено
--
--   Квитанция поставщика (файл) хранится в приватном бакете documents
--   по пути '<order_id>/parts/<uuid>.<ext>' — первый сегмент пути
--   связывает объект с заказом, поэтому Storage-RLS заказа применяется
--   автоматически (как для фото и PDF).
-- ============================================================

create table public.order_parts (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id),
  name text not null,
  shop_url text check (shop_url is null or shop_url ~* '^https?://'),
  cost numeric(12, 2) not null default 0 check (cost >= 0),
  qty numeric(10, 2) not null default 1 check (qty > 0),
  status text not null default 'need_order'
    check (status in ('need_order', 'ordered', 'received')),
  receipt_path text,               -- путь в бакете documents (квитанция поставщика)
  receipt_name text,               -- исходное имя файла для скачивания
  note text,
  ordered_at timestamptz,          -- проставляется при переходе в 'ordered'
  received_at timestamptz,         -- проставляется при переходе в 'received'
  deleted_at timestamptz,
  deleted_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_order_parts_order on public.order_parts (order_id) where deleted_at is null;
create index idx_order_parts_status on public.order_parts (status) where deleted_at is null;

-- updated_at + аудит как у остальных пользовательских таблиц
create trigger trg_order_parts_updated_at before update on public.order_parts
  for each row execute function public.set_updated_at();
create trigger trg_order_parts_audit after insert or update on public.order_parts
  for each row execute function public.fn_audit();
create trigger trg_order_parts_forbid_delete before delete on public.order_parts
  for each row execute function public.fn_forbid_delete();
create trigger trg_order_parts_guard_soft_delete before update on public.order_parts
  for each row execute function public.fn_guard_soft_delete();

-- Автопроставление меток времени по смене статуса закупки
create or replace function public.fn_order_parts_timestamps()
returns trigger
language plpgsql
as $$
begin
  if new.status = 'ordered' and new.ordered_at is null then
    new.ordered_at := now();
  end if;
  if new.status = 'received' and new.received_at is null then
    new.received_at := now();
  end if;
  return new;
end $$;

create trigger trg_order_parts_timestamps before insert or update on public.order_parts
  for each row execute function public.fn_order_parts_timestamps();

-- ------------------------------------------------------------
-- RLS: видимость и правки — через видимость заказа (как order_items).
-- Мастер ведёт закупку по своим заказам, soft delete — менеджер/админ
-- (через trg_order_parts_guard_soft_delete).
-- ------------------------------------------------------------
alter table public.order_parts enable row level security;

create policy order_parts_select on public.order_parts
  for select to authenticated using (
    exists (select 1 from public.orders o where o.id = order_parts.order_id)
  );
create policy order_parts_insert on public.order_parts
  for insert to authenticated with check (
    public.is_active_staff()
    and exists (select 1 from public.orders o where o.id = order_parts.order_id)
  );
create policy order_parts_update on public.order_parts
  for update to authenticated using (
    exists (select 1 from public.orders o where o.id = order_parts.order_id)
  ) with check (
    exists (select 1 from public.orders o where o.id = order_parts.order_id)
  );

-- ------------------------------------------------------------
-- Storage: разрешаем сотрудникам загружать квитанции поставщика в
-- бакет documents (раньше туда писал только service_role при генерации
-- PDF). Путь обязан начинаться с order_id видимого заказа.
-- ------------------------------------------------------------
do $do$
begin
  if not exists (
    select 1 from information_schema.tables
    where table_schema = 'storage' and table_name = 'objects'
  ) then
    raise notice 'storage schema отсутствует — политика пропущена (локальный тест)';
    return;
  end if;

  execute $pol$
    create policy storage_docs_insert_staff on storage.objects
      for insert to authenticated with check (
        bucket_id = 'documents'
        and public.is_active_staff()
        and exists (select 1 from public.orders o where o.id = public.path_order_id(name))
      )
  $pol$;
end $do$;
