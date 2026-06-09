-- ============================================================
-- Миграция 5: индексы (поиск по десяткам тысяч моделей,
-- фильтры заказов, очередь уведомлений, аудит)
-- ============================================================

-- Справочник: автодополнение и навигация
create index idx_models_name_trgm on public.models using gin (name_normalized gin_trgm_ops);
create index idx_models_cat_brand on public.models (category_id, brand_id) where deleted_at is null;
create index idx_brands_name_trgm on public.brands using gin (name_normalized gin_trgm_ops);

-- Клиенты: поиск по имени и куску телефона
create index idx_clients_name_trgm on public.clients using gin (name gin_trgm_ops) where deleted_at is null;
create index idx_clients_phone on public.clients (phone) where deleted_at is null;
create index idx_clients_phone_trgm on public.clients using gin (phone gin_trgm_ops) where deleted_at is null;

-- Устройства: серийник и доп-поля (IMEI и т.п.)
create index idx_devices_serial on public.devices (serial_normalized) where deleted_at is null;
create index idx_devices_serial_trgm on public.devices using gin (serial_normalized gin_trgm_ops) where deleted_at is null;
create index idx_devices_cf_trgm on public.devices using gin ((custom_fields::text) gin_trgm_ops) where deleted_at is null;

-- Заказы: главная таблица, фильтры, виджеты
create index idx_orders_status_due on public.orders (status, due_date) where deleted_at is null;
create index idx_orders_master on public.orders (master_id) where deleted_at is null;
create index idx_orders_manager on public.orders (manager_id) where deleted_at is null;
create index idx_orders_client on public.orders (client_id) where deleted_at is null;
create index idx_orders_accepted_at on public.orders (accepted_at desc) where deleted_at is null;

-- Строки заказа: суммы
create index idx_order_items_order on public.order_items (order_id) where deleted_at is null;

-- История статусов: карточка заказа и виджет «выдано сегодня»
create index idx_history_order on public.order_status_history (order_id, created_at);
create index idx_history_issued on public.order_status_history (to_status, created_at);

-- Файлы и документы
create index idx_attachments_order on public.attachments (order_id) where deleted_at is null;
create index idx_order_documents_order on public.order_documents (order_id);

-- Outbox: cron выбирает только хвост очереди
create index idx_outbox_pending on public.notification_outbox (next_retry_at, created_at) where status = 'pending';
create index idx_outbox_order on public.notification_outbox (order_id);

-- Аудит
create index idx_audit_record on public.audit_log (table_name, record_id);
create index idx_audit_created_brin on public.audit_log using brin (created_at);
