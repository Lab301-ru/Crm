-- ============================================================
-- Миграция 2: таблицы (модель данных Этапа 3/4)
-- ============================================================

-- ------------------------------------------------------------
-- Сотрудники (1:1 с auth.users)
-- ------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null,
  phone text,
  role text not null check (role in ('admin', 'manager', 'master')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ------------------------------------------------------------
-- Настройки организации (singleton)
-- ------------------------------------------------------------
create table public.org_settings (
  id int primary key default 1 check (id = 1),
  name text not null default 'Сервисный центр',
  inn text,
  address text,
  phone text,
  working_hours text,
  public_contacts text,            -- контакты для публичной QR-страницы
  order_prefix text not null default 'L',
  default_warranty_days int not null default 30 check (default_warranty_days >= 0),
  receipt_disclaimer text,         -- текст-оговорка на квитанции
  photo_retention_days int,        -- NULL = хранить вечно
  timezone text not null default 'Europe/Moscow',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ------------------------------------------------------------
-- Клиенты
-- ------------------------------------------------------------
create table public.clients (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text not null,             -- E.164, заполняется триггером из phone_display
  phone_display text,
  messenger text,
  email text check (email is null or email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  comment text,
  telegram_chat_id bigint,         -- после opt-in через бота
  deleted_at timestamptz,
  deleted_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ------------------------------------------------------------
-- Справочник техники: Категория → Бренд → Модель
-- ------------------------------------------------------------
create table public.categories (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  name_normalized text generated always as (lower(btrim(name))) stored,
  sort int not null default 100,
  deleted_at timestamptz,
  deleted_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index uq_categories_name on public.categories (name_normalized) where deleted_at is null;

create table public.brands (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  name_normalized text generated always as (lower(btrim(name))) stored,
  deleted_at timestamptz,
  deleted_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index uq_brands_name on public.brands (name_normalized);

create table public.models (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references public.categories (id),
  brand_id uuid not null references public.brands (id),
  name text not null,
  name_normalized text generated always as (lower(btrim(name))) stored,
  deleted_at timestamptz,
  deleted_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint uq_models unique (category_id, brand_id, name_normalized)
);

-- ------------------------------------------------------------
-- Шаблоны динамических полей по категориям
-- ------------------------------------------------------------
create table public.field_templates (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references public.categories (id),
  key text not null check (key ~ '^[a-z][a-z0-9_]*$'),
  label text not null,
  field_type text not null check (field_type in ('text', 'number', 'select', 'multiselect', 'boolean', 'date')),
  options jsonb check (options is null or jsonb_typeof(options) = 'array'),
  is_required boolean not null default false,
  sort int not null default 100,
  is_active boolean not null default true,
  deleted_at timestamptz,
  deleted_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint uq_field_templates unique (category_id, key)
);

-- ------------------------------------------------------------
-- Устройства (1:1 с заказом)
-- ------------------------------------------------------------
create table public.devices (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references public.categories (id),
  brand_id uuid not null references public.brands (id),
  model_id uuid references public.models (id),
  serial_number text,
  serial_normalized text generated always as (nullif(lower(regexp_replace(coalesce(serial_number, ''), '\s', '', 'g')), '')) stored,
  completeness text,
  appearance text,
  is_warranty_case boolean not null default false,
  custom_fields jsonb not null default '{}'::jsonb,
  deleted_at timestamptz,
  deleted_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ------------------------------------------------------------
-- State machine: статусы и разрешённые переходы — это данные
-- ------------------------------------------------------------
create table public.statuses (
  code text primary key,
  label text not null,
  color text not null default '#9CA3AF',
  sort int not null default 100,
  is_terminal boolean not null default false
);

create table public.status_transitions (
  from_code text not null references public.statuses (code),
  to_code text not null references public.statuses (code),
  primary key (from_code, to_code)
);

-- ------------------------------------------------------------
-- Заказ-наряд
-- ------------------------------------------------------------
create sequence public.order_number_seq start with 10001;

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  number bigint not null unique,
  display_number text not null unique,
  client_id uuid not null references public.clients (id),
  device_id uuid not null unique references public.devices (id),
  status text not null references public.statuses (code),
  manager_id uuid not null references public.profiles (id),
  master_id uuid references public.profiles (id),
  accepted_at timestamptz,
  due_date date,
  claimed_defect text not null,
  diagnostic_result text,
  master_comment text,
  public_comment text,             -- «комментарий сервиса» на публичной QR-странице
  prepayment numeric(12, 2) not null default 0 check (prepayment >= 0),
  payment_status text not null default 'unpaid' check (payment_status in ('unpaid', 'prepaid', 'paid')),
  payment_method text check (payment_method in ('cash', 'card', 'transfer')),
  warranty_days int check (warranty_days >= 0),
  qr_token text not null unique default encode(gen_random_bytes(16), 'hex'),
  linked_order_id uuid references public.orders (id),
  deleted_at timestamptz,
  deleted_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ------------------------------------------------------------
-- Строки работ и запчастей
-- ------------------------------------------------------------
create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id),
  item_type text not null check (item_type in ('work', 'part')),
  name text not null,
  price numeric(12, 2) not null check (price >= 0),
  qty numeric(10, 2) not null default 1 check (qty > 0),
  deleted_at timestamptz,
  deleted_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ------------------------------------------------------------
-- История статусов (append-only)
-- ------------------------------------------------------------
create table public.order_status_history (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id),
  from_status text references public.statuses (code),  -- NULL = создание заказа
  to_status text not null references public.statuses (code),
  changed_by uuid references public.profiles (id),
  comment text,
  created_at timestamptz not null default now()
);

-- ------------------------------------------------------------
-- Файлы
-- ------------------------------------------------------------
create table public.attachments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id),
  kind text not null check (kind in ('device_photo', 'serial_photo', 'document', 'receipt', 'warranty_doc')),
  storage_path text not null,
  file_name text not null,
  mime_type text,
  size_bytes bigint,
  uploaded_by uuid references public.profiles (id),
  deleted_at timestamptz,
  deleted_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ------------------------------------------------------------
-- Сгенерированные PDF-документы (snapshot = воспроизводимость)
-- ------------------------------------------------------------
create table public.order_documents (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id),
  doc_type text not null check (doc_type in ('intake_receipt', 'work_act', 'issue_act', 'warranty_card')),
  storage_path text not null,
  snapshot jsonb not null,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now()
);

-- ------------------------------------------------------------
-- Правила уведомлений (событие × канал)
-- ------------------------------------------------------------
create table public.notification_rules (
  id uuid primary key default gen_random_uuid(),
  event_type text not null,
  channel text not null check (channel in ('telegram', 'email', 'phone_call')),
  enabled boolean not null default true,
  template text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint uq_notification_rules unique (event_type, channel)
);

-- ------------------------------------------------------------
-- Outbox уведомлений (идемпотентность через event_key)
-- ------------------------------------------------------------
create table public.notification_outbox (
  id uuid primary key default gen_random_uuid(),
  event_key text not null unique,
  order_id uuid not null references public.orders (id),
  event_type text not null,
  channel text not null check (channel in ('telegram', 'email', 'phone_call')),
  recipient text,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check (status in ('pending', 'sent', 'failed', 'skipped', 'manual_done')),
  attempts int not null default 0,
  next_retry_at timestamptz,
  last_error text,
  sent_at timestamptz,
  done_by uuid references public.profiles (id),  -- кто закрыл phone_call
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ------------------------------------------------------------
-- Аудит (append-only; record_id text — ключи бывают uuid и int)
-- ------------------------------------------------------------
create table public.audit_log (
  id bigint generated always as identity primary key,
  table_name text not null,
  record_id text not null,
  action text not null check (action in ('INSERT', 'UPDATE', 'SOFT_DELETE')),
  actor_id uuid,
  changed jsonb,
  created_at timestamptz not null default now()
);

-- ------------------------------------------------------------
-- updated_at на всех таблицах, где он есть
-- ------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'profiles', 'org_settings', 'clients', 'categories', 'brands', 'models',
    'field_templates', 'devices', 'orders', 'order_items', 'attachments',
    'notification_rules', 'notification_outbox'
  ] loop
    execute format(
      'create trigger trg_%s_updated_at before update on public.%I
       for each row execute function public.set_updated_at()', t, t);
  end loop;
end $$;
