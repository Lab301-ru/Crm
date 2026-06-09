# ЭТАП 4: ER-диаграмма

> Статус: **на утверждении**.
> Диаграмма покрывает все таблицы Этапа 3. Для читаемости на диаграмме опущены служебные колонки `created_at` / `updated_at` (есть во всех таблицах) и `deleted_at` / `deleted_by` (есть во всех таблицах с пользовательскими данными: clients, categories, brands, models, field_templates, devices, orders, order_items, attachments).

**Уточнение к Этапу 3:** простые перечисления без UI-атрибутов (`role`, `field_type`, `payment_status`, `payment_method`, `item_type`, `kind`, `doc_type`, `channel`, статусы outbox) реализуются **CHECK-ограничениями**, а не справочными таблицами — им не нужны редактируемые подписи. Отдельной таблицей остаются только `statuses` (нужны label, цвет, порядок — UX-N1) и `status_transitions` (правила переходов = данные).

---

## Диаграмма

```mermaid
erDiagram
    %% ===== Люди и организация =====
    profiles {
        uuid id PK "= auth.users.id"
        text full_name
        text phone
        text role "CHECK: admin | manager | master"
        boolean is_active
    }

    org_settings {
        int id PK "CHECK (id = 1) — singleton"
        text name
        text inn
        text address
        text phone
        text working_hours
        text public_contacts "для QR-страницы"
        text order_prefix "default 'L'"
        int default_warranty_days
        text receipt_disclaimer
        int photo_retention_days "NULL = хранить вечно"
    }

    clients {
        uuid id PK
        text name
        text phone "E.164, индекс trgm"
        text phone_display
        text messenger
        text email
        text comment
        bigint telegram_chat_id "после opt-in"
    }

    %% ===== Справочник техники =====
    categories {
        uuid id PK
        text name
        text name_normalized "UNIQUE, generated"
        int sort
    }

    brands {
        uuid id PK
        text name
        text name_normalized "UNIQUE, generated, trgm"
    }

    models {
        uuid id PK
        uuid category_id FK
        uuid brand_id FK
        text name
        text name_normalized "generated, trgm; UNIQUE(category,brand,name)"
    }

    field_templates {
        uuid id PK
        uuid category_id FK
        text key "immutable, UNIQUE(category_id, key)"
        text label
        text field_type "CHECK: text|number|select|multiselect|boolean|date"
        jsonb options "варианты для select"
        boolean is_required
        int sort
        boolean is_active
    }

    %% ===== Устройство и заказ =====
    devices {
        uuid id PK
        uuid category_id FK
        uuid brand_id FK
        uuid model_id FK
        text serial_number
        text serial_normalized "generated, trgm"
        text completeness "комплектация"
        text appearance "внешнее состояние"
        boolean is_warranty_case
        jsonb custom_fields "валидация триггером по шаблонам"
    }

    statuses {
        text code PK "new..scrapped"
        text label "рус. название"
        text color "hex — цветные статусы (UX-N1)"
        int sort
        boolean is_terminal
    }

    status_transitions {
        text from_code PK,FK
        text to_code PK,FK
    }

    orders {
        uuid id PK
        bigint number "sequence"
        text display_number "UNIQUE, 'L-10001'"
        uuid client_id FK
        uuid device_id FK "UNIQUE — 1:1"
        text status FK "менять только через RPC change_status"
        uuid manager_id FK
        uuid master_id FK
        timestamptz accepted_at
        date due_date "просрочка = бейдж в UI"
        text claimed_defect "заявленная неисправность"
        text diagnostic_result
        text master_comment
        numeric prepayment
        text payment_status "CHECK: unpaid|prepaid|paid"
        text payment_method "CHECK: cash|card|transfer"
        int warranty_days
        text qr_token "UNIQUE, 128 бит"
        uuid linked_order_id FK "повторный ремонт"
    }

    order_items {
        uuid id PK
        uuid order_id FK
        text item_type "CHECK: work | part"
        text name
        numeric price "CHECK >= 0"
        numeric qty "CHECK > 0"
    }

    order_status_history {
        uuid id PK
        uuid order_id FK
        text from_status FK
        text to_status FK
        uuid changed_by FK
        text comment
        timestamptz created_at "append-only"
    }

    %% ===== Файлы и документы =====
    attachments {
        uuid id PK
        uuid order_id FK
        text kind "CHECK: device_photo|serial_photo|document|receipt|warranty_doc"
        text storage_path "bucket/order_id/uuid.ext"
        text file_name
        text mime_type
        bigint size_bytes
        uuid uploaded_by FK
    }

    order_documents {
        uuid id PK
        uuid order_id FK
        text doc_type "CHECK: intake_receipt|work_act|issue_act|warranty_card"
        text storage_path
        jsonb snapshot "данные на момент генерации"
        uuid created_by FK
        timestamptz created_at
    }

    %% ===== Уведомления и аудит =====
    notification_rules {
        uuid id PK
        text event_type "7 событий из постановки"
        text channel "CHECK: telegram | email | phone_call"
        boolean enabled
        text template "плейсхолдеры {order_number}.."
    }

    notification_outbox {
        uuid id PK
        text event_key "UNIQUE: order:event:channel — идемпотентность"
        uuid order_id FK
        text event_type
        text channel "CHECK: telegram | email | phone_call"
        text recipient
        jsonb payload
        text status "CHECK: pending|sent|failed|skipped|manual_done"
        int attempts
        timestamptz next_retry_at "partial index WHERE pending"
        text last_error
        timestamptz sent_at
        uuid done_by FK "кто закрыл phone_call"
    }

    audit_log {
        bigint id PK "bigserial — компактнее uuid"
        text table_name "индекс (table_name, record_id)"
        uuid record_id
        text action "CHECK: INSERT|UPDATE|SOFT_DELETE"
        uuid actor_id
        jsonb changed "diff: только изменённые поля"
        timestamptz created_at "append-only, BRIN"
    }

    %% ===== Связи =====
    clients ||--o{ orders : "оформляет"
    devices ||--|| orders : "1 заказ = 1 устройство"
    profiles ||--o{ orders : "менеджер"
    profiles ||--o{ orders : "мастер"
    statuses ||--o{ orders : "текущий статус"
    orders |o--o{ orders : "повторный ремонт"

    categories ||--o{ models : ""
    brands ||--o{ models : ""
    categories ||--o{ field_templates : "шаблоны полей"
    categories ||--o{ devices : ""
    brands ||--o{ devices : ""
    models |o--o{ devices : "model_id"

    statuses ||--o{ status_transitions : "from"
    statuses ||--o{ status_transitions : "to"

    orders ||--o{ order_items : "работы и запчасти"
    orders ||--o{ order_status_history : "история"
    orders ||--o{ attachments : "файлы"
    orders ||--o{ order_documents : "PDF"
    orders ||--o{ notification_outbox : "уведомления"

    statuses ||--o{ order_status_history : "from"
    statuses ||--o{ order_status_history : "to"
    profiles ||--o{ order_status_history : "кто сменил"
    profiles ||--o{ attachments : "кто загрузил"
    profiles ||--o{ order_documents : "кто сформировал"
```

`audit_log`, `org_settings` и `notification_rules` связей-стрелок не имеют намеренно: аудит полиморфен (`table_name` + `record_id`, без FK — журнал не должен мешать ничему и зависеть ни от чего), настройки — singleton, правила уведомлений — конфигурация по `event_type`.

## Контрольная сверка с требованиями постановки

| Требование | Покрыто |
|---|---|
| Клиент: имя·телефон·мессенджер·email·комментарий | `clients` |
| Устройство: категория·бренд·модель·серийник·комплектация·состояние·гарантийный случай·фото | `devices` + `attachments(kind)` |
| Неисправность: заявленная·диагностика·работы·комментарий мастера | `orders.claimed_defect / diagnostic_result / master_comment` + `order_items(work)` |
| Заказ: номер·дата приёма·план готовности·статус·мастер·менеджер | `orders` |
| Финансы: работы·запчасти·предоплата·итог·статус оплаты | `order_items` + `orders.prepayment/payment_*` + view итогов |
| State machine + история смен | `statuses`, `status_transitions`, `order_status_history` |
| Динамические справочники + импорт | `categories/brands/models` + UNIQUE-ключ для upsert |
| Динамические поля без миграций | `field_templates` + `devices.custom_fields` |
| QR по токену | `orders.qr_token` |
| Аудит неизменяемый, soft delete | `audit_log`, `deleted_at/deleted_by` |
| Идемпотентные уведомления | `notification_outbox.event_key UNIQUE` |
| PDF-документы | `order_documents` + snapshot |

## Что будет на следующем этапе

**Этап 5 — SQL-схема**: полный DDL одним артефактом — расширения (pg_trgm, pg_cron), таблицы, CHECK/FK, generated-колонки, все индексы, триггеры (аудит, soft delete, state machine, валидация custom_fields, outbox), функции (`create_order`, `change_status`, `import_catalog_batch`, `quick_add_model`, `global_search`), view `orders_with_totals`, RLS-политики всех таблиц, seed (статусы, переходы, правила уведомлений).

## ⏸️ СТОП

Жду подтверждения для перехода к Этапу 5.
