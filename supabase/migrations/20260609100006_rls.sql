-- ============================================================
-- Миграция 6: RLS — ролевая модель на сервере
--   admin   — всё
--   manager — заказы/клиенты/файлы, быстрые модели
--   master  — только свои заказы (и их клиенты/устройства/файлы)
-- Анонимам не доступно ничего (политики только to authenticated;
-- публичная страница ходит через Edge Function + service_role).
-- ============================================================

alter table public.profiles enable row level security;
alter table public.org_settings enable row level security;
alter table public.clients enable row level security;
alter table public.categories enable row level security;
alter table public.brands enable row level security;
alter table public.models enable row level security;
alter table public.field_templates enable row level security;
alter table public.devices enable row level security;
alter table public.statuses enable row level security;
alter table public.status_transitions enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.order_status_history enable row level security;
alter table public.attachments enable row level security;
alter table public.order_documents enable row level security;
alter table public.notification_rules enable row level security;
alter table public.notification_outbox enable row level security;
alter table public.audit_log enable row level security;

-- ------------------------------------------------------------
-- profiles: все активные сотрудники видят список; правит админ
-- ------------------------------------------------------------
create policy profiles_select on public.profiles
  for select to authenticated using (public.is_active_staff());
create policy profiles_insert on public.profiles
  for insert to authenticated with check (public.is_admin());
create policy profiles_update on public.profiles
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

-- ------------------------------------------------------------
-- org_settings: читают все, правит админ
-- ------------------------------------------------------------
create policy org_settings_select on public.org_settings
  for select to authenticated using (public.is_active_staff());
create policy org_settings_insert on public.org_settings
  for insert to authenticated with check (public.is_admin());
create policy org_settings_update on public.org_settings
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

-- ------------------------------------------------------------
-- clients: менеджер/админ — все; мастер — клиенты своих заказов
-- (подзапрос к orders сам применяет RLS заказов)
-- ------------------------------------------------------------
create policy clients_select on public.clients
  for select to authenticated using (
    public.is_manager_up()
    or exists (select 1 from public.orders o where o.client_id = clients.id)
  );
create policy clients_insert on public.clients
  for insert to authenticated with check (public.is_manager_up());
create policy clients_update on public.clients
  for update to authenticated using (public.is_manager_up()) with check (public.is_manager_up());

-- ------------------------------------------------------------
-- Справочники: читают все сотрудники, правит админ
-- (быстрое добавление модели менеджером — через definer-RPC)
-- ------------------------------------------------------------
create policy categories_select on public.categories
  for select to authenticated using (public.is_active_staff());
create policy categories_write_insert on public.categories
  for insert to authenticated with check (public.is_admin());
create policy categories_write_update on public.categories
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

create policy brands_select on public.brands
  for select to authenticated using (public.is_active_staff());
create policy brands_write_insert on public.brands
  for insert to authenticated with check (public.is_admin());
create policy brands_write_update on public.brands
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

create policy models_select on public.models
  for select to authenticated using (public.is_active_staff());
create policy models_write_insert on public.models
  for insert to authenticated with check (public.is_admin());
create policy models_write_update on public.models
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

create policy field_templates_select on public.field_templates
  for select to authenticated using (public.is_active_staff());
create policy field_templates_insert on public.field_templates
  for insert to authenticated with check (public.is_admin());
create policy field_templates_update on public.field_templates
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

-- ------------------------------------------------------------
-- statuses / status_transitions: читают все, правит админ
-- ------------------------------------------------------------
create policy statuses_select on public.statuses
  for select to authenticated using (public.is_active_staff());
create policy statuses_insert on public.statuses
  for insert to authenticated with check (public.is_admin());
create policy statuses_update on public.statuses
  for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy statuses_delete on public.statuses
  for delete to authenticated using (public.is_admin());

create policy transitions_select on public.status_transitions
  for select to authenticated using (public.is_active_staff());
create policy transitions_insert on public.status_transitions
  for insert to authenticated with check (public.is_admin());
create policy transitions_delete on public.status_transitions
  for delete to authenticated using (public.is_admin());

-- ------------------------------------------------------------
-- orders: менеджер/админ — все; мастер — только назначенные ему
-- ------------------------------------------------------------
create policy orders_select on public.orders
  for select to authenticated using (
    public.is_manager_up()
    or (public.is_master() and master_id = auth.uid())
  );
create policy orders_insert on public.orders
  for insert to authenticated with check (public.is_manager_up());
create policy orders_update on public.orders
  for update to authenticated using (
    public.is_manager_up()
    or (public.is_master() and master_id = auth.uid())
  ) with check (
    public.is_manager_up()
    or (public.is_master() and master_id = auth.uid())
  );

-- ------------------------------------------------------------
-- devices: видимость и правки — через видимость заказа
-- ------------------------------------------------------------
create policy devices_select on public.devices
  for select to authenticated using (
    public.is_manager_up()
    or exists (select 1 from public.orders o where o.device_id = devices.id)
  );
create policy devices_insert on public.devices
  for insert to authenticated with check (public.is_manager_up());
create policy devices_update on public.devices
  for update to authenticated using (
    public.is_manager_up()
    or exists (select 1 from public.orders o where o.device_id = devices.id)
  ) with check (
    public.is_manager_up()
    or exists (select 1 from public.orders o where o.device_id = devices.id)
  );

-- ------------------------------------------------------------
-- order_items: через видимость заказа; мастер правит свои
-- ------------------------------------------------------------
create policy order_items_select on public.order_items
  for select to authenticated using (
    exists (select 1 from public.orders o where o.id = order_items.order_id)
  );
create policy order_items_insert on public.order_items
  for insert to authenticated with check (
    exists (select 1 from public.orders o where o.id = order_items.order_id)
  );
create policy order_items_update on public.order_items
  for update to authenticated using (
    exists (select 1 from public.orders o where o.id = order_items.order_id)
  ) with check (
    exists (select 1 from public.orders o where o.id = order_items.order_id)
  );

-- ------------------------------------------------------------
-- order_status_history: чтение через видимость заказа;
-- запись — только из change_status() (security definer)
-- ------------------------------------------------------------
create policy history_select on public.order_status_history
  for select to authenticated using (
    exists (select 1 from public.orders o where o.id = order_status_history.order_id)
  );

-- ------------------------------------------------------------
-- attachments: через видимость заказа
-- ------------------------------------------------------------
create policy attachments_select on public.attachments
  for select to authenticated using (
    exists (select 1 from public.orders o where o.id = attachments.order_id)
  );
create policy attachments_insert on public.attachments
  for insert to authenticated with check (
    public.is_active_staff()
    and exists (select 1 from public.orders o where o.id = attachments.order_id)
  );
create policy attachments_update on public.attachments
  for update to authenticated using (public.is_manager_up()) with check (public.is_manager_up());

-- ------------------------------------------------------------
-- order_documents: чтение через заказ; создание — менеджер/админ
-- (генерация PDF идёт через Edge Function с service_role)
-- ------------------------------------------------------------
create policy documents_select on public.order_documents
  for select to authenticated using (
    exists (select 1 from public.orders o where o.id = order_documents.order_id)
  );
create policy documents_insert on public.order_documents
  for insert to authenticated with check (public.is_manager_up());

-- ------------------------------------------------------------
-- notification_rules: читают все, правит админ
-- ------------------------------------------------------------
create policy rules_select on public.notification_rules
  for select to authenticated using (public.is_active_staff());
create policy rules_insert on public.notification_rules
  for insert to authenticated with check (public.is_admin());
create policy rules_update on public.notification_rules
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

-- ------------------------------------------------------------
-- notification_outbox: видят менеджер/админ (задачи «позвонить» и
-- статусы доставки); запись — только функции
-- ------------------------------------------------------------
create policy outbox_select on public.notification_outbox
  for select to authenticated using (public.is_manager_up());

-- ------------------------------------------------------------
-- audit_log: только админ; запись — только триггеры (definer)
-- ------------------------------------------------------------
create policy audit_select on public.audit_log
  for select to authenticated using (public.is_admin());
