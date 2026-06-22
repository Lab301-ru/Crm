-- ============================================================
-- Модуль «Запчасти»: расширенный закупочный трекинг по заказу.
--   order_parts — отдельная сущность от order_items: order_items
--   фиксирует ЧТО продано клиенту (работа/запчасть в чеке), а
--   order_parts ведёт ЗАКУПКУ детали (где заказать, у какого
--   поставщика, статус доставки, файлы). Один заказ → много позиций.
--
--   Назначение: ежедневный дашборд закупщика — что заказать, какую
--   запчасть и где, что мастер уже купил сам, с чеками/накладными.
--
--   Статусы закупки (5):
--     need_order — нужно заказать
--     ordered    — заказана
--     in_transit — в пути
--     received   — получена
--     installed  — установлена
--
--   Поля «Основное»:    name, qty, master_comment, order связь
--   Поля «Закупка»:     shop_url (ссылка), cost (закупка), supplier (поставщик)
--   Файлы (3):          screenshot (скриншот заказа), receipt (чек),
--                       invoice (накладная) — путь+имя на каждый
--
--   Файлы хранятся в приватном бакете documents по пути
--   '<order_id>/parts/<uuid>.<ext>' — RLS заказа применяется
--   по первому сегменту пути (как для фото и PDF).
-- ============================================================

create table if not exists public.order_parts (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id),
  name text not null,
  qty numeric(10, 2) not null default 1 check (qty > 0),
  master_comment text,                                       -- комментарий мастера
  shop_url text check (shop_url is null or shop_url ~* '^https?://'),
  cost numeric(12, 2) not null default 0 check (cost >= 0),  -- цена закупки
  supplier text,                                             -- поставщик
  status text not null default 'need_order',
  -- Файлы (3 типа): скриншот заказа, чек о покупке, накладная
  screenshot_path text, screenshot_name text,
  receipt_path text,    receipt_name text,
  invoice_path text,    invoice_name text,
  note text,                                                 -- общий комментарий
  ordered_at timestamptz,
  received_at timestamptz,
  installed_at timestamptz,
  deleted_at timestamptz,
  deleted_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Идемпотентная установка проверки статуса (если миграция накатывается
-- поверх ранее существовавшего ограничения с 3 значениями).
do $$ begin
  if exists (select 1 from pg_constraint where conname = 'order_parts_status_check') then
    alter table public.order_parts drop constraint order_parts_status_check;
  end if;
  alter table public.order_parts add constraint order_parts_status_check
    check (status in ('need_order', 'ordered', 'in_transit', 'received', 'installed'));
end $$;

-- Добавляем «новые» колонки идемпотентно (если таблица уже была создана
-- старой версией миграции с меньшим набором полей).
alter table public.order_parts add column if not exists master_comment text;
alter table public.order_parts add column if not exists supplier text;
alter table public.order_parts add column if not exists screenshot_path text;
alter table public.order_parts add column if not exists screenshot_name text;
alter table public.order_parts add column if not exists invoice_path text;
alter table public.order_parts add column if not exists invoice_name text;
alter table public.order_parts add column if not exists installed_at timestamptz;

create index if not exists idx_order_parts_order on public.order_parts (order_id) where deleted_at is null;
create index if not exists idx_order_parts_status on public.order_parts (status) where deleted_at is null;

-- updated_at + аудит как у остальных пользовательских таблиц
do $$ begin
  if not exists (select 1 from pg_trigger where tgname='trg_order_parts_updated_at') then
    create trigger trg_order_parts_updated_at before update on public.order_parts
      for each row execute function public.set_updated_at();
  end if;
  if not exists (select 1 from pg_trigger where tgname='trg_order_parts_audit') then
    create trigger trg_order_parts_audit after insert or update on public.order_parts
      for each row execute function public.fn_audit();
  end if;
  if not exists (select 1 from pg_trigger where tgname='trg_order_parts_forbid_delete') then
    create trigger trg_order_parts_forbid_delete before delete on public.order_parts
      for each row execute function public.fn_forbid_delete();
  end if;
  if not exists (select 1 from pg_trigger where tgname='trg_order_parts_guard_soft_delete') then
    create trigger trg_order_parts_guard_soft_delete before update on public.order_parts
      for each row execute function public.fn_guard_soft_delete();
  end if;
end $$;

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
  if new.status = 'installed' and new.installed_at is null then
    new.installed_at := now();
  end if;
  return new;
end $$;

do $$ begin
  if not exists (select 1 from pg_trigger where tgname='trg_order_parts_timestamps') then
    create trigger trg_order_parts_timestamps before insert or update on public.order_parts
      for each row execute function public.fn_order_parts_timestamps();
  end if;
end $$;

-- ------------------------------------------------------------
-- RLS: видимость и правки — через видимость заказа (как order_items).
-- Мастер ведёт закупку по своим заказам, soft delete — менеджер/админ
-- (через trg_order_parts_guard_soft_delete).
-- ------------------------------------------------------------
alter table public.order_parts enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='order_parts' and policyname='order_parts_select') then
    create policy order_parts_select on public.order_parts
      for select to authenticated using (
        exists (select 1 from public.orders o where o.id = order_parts.order_id)
      );
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='order_parts' and policyname='order_parts_insert') then
    create policy order_parts_insert on public.order_parts
      for insert to authenticated with check (
        public.is_active_staff()
        and exists (select 1 from public.orders o where o.id = order_parts.order_id)
      );
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='order_parts' and policyname='order_parts_update') then
    create policy order_parts_update on public.order_parts
      for update to authenticated using (
        exists (select 1 from public.orders o where o.id = order_parts.order_id)
      ) with check (
        exists (select 1 from public.orders o where o.id = order_parts.order_id)
      );
  end if;
end $$;

-- ------------------------------------------------------------
-- Storage: разрешаем сотрудникам загружать файлы запчастей в бакет
-- documents (раньше туда писал только service_role). Путь обязан
-- начинаться с order_id видимого заказа.
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

  if not exists (select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='storage_docs_insert_staff') then
    execute $pol$
      create policy storage_docs_insert_staff on storage.objects
        for insert to authenticated with check (
          bucket_id = 'documents'
          and public.is_active_staff()
          and exists (select 1 from public.orders o where o.id = public.path_order_id(name))
        )
    $pol$;
  end if;
end $do$;

-- ------------------------------------------------------------
-- View: дашборд закупщика «Все запчасти по всем заказам».
-- Поля: запчасть + кто/где (заказ, клиент, устройство, мастер).
-- ------------------------------------------------------------
create or replace view public.parts_overview
with (security_invoker = true)
as
select
  p.id, p.order_id, p.name, p.qty, p.master_comment,
  p.shop_url, p.cost, p.supplier, p.status,
  p.screenshot_path, p.screenshot_name,
  p.receipt_path,    p.receipt_name,
  p.invoice_path,    p.invoice_name,
  p.note,
  p.ordered_at, p.received_at, p.installed_at,
  p.created_at, p.updated_at,
  o.display_number  as order_number,
  o.status          as order_status,
  s.label           as order_status_label,
  s.color           as order_status_color,
  o.master_id,
  c.name            as client_name,
  c.phone           as client_phone,
  concat_ws(' ', cat.name, b.name, coalesce(m.name,'')) as device_label
from public.order_parts p
join public.orders o     on o.id = p.order_id and o.deleted_at is null
join public.statuses s   on s.code = o.status
join public.clients c    on c.id = o.client_id
join public.devices d    on d.id = o.device_id
join public.categories cat on cat.id = d.category_id
join public.brands b     on b.id = d.brand_id
left join public.models m on m.id = d.model_id
where p.deleted_at is null;

grant select on public.parts_overview to authenticated, service_role;
