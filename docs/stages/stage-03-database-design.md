# ЭТАП 3: Проектирование базы данных

> Статус: **на утверждении**.
> Новое зафиксированное требование **UX-N1**: пользователь 5 лет работал в Workpan — модель данных и интерфейс должны воспроизводить привычные паттерны Workpan (заказ-наряд как центр системы, цветные статусы, строки работ/запчастей, быстрый поиск).

---

## 1. Принципы

1. **Заказ-наряд — центр модели** (как в Workpan): всё остальное (устройство, финансы, файлы, документы, уведомления, история) висит на заказе.
2. **3НФ для основных сущностей**; две сознательные денормализации, обе обоснованы: JSONB для динамических полей (§4) и снэпшоты данных в PDF-документах (§3.12).
3. **Целостность — в БД**: enum-подобные значения через справочные таблицы с FK, переходы статусов — данные в таблице, а не код; суммы заказа не хранятся, а считаются.
4. **Ничего не удаляется физически**: `deleted_at`/`deleted_by` везде, где есть пользовательские данные; журналы (аудит, история статусов, уведомления) — append-only.
5. Все таблицы: `id uuid PK (gen_random_uuid())`, `created_at`, `updated_at` (триггер). Деньги — `numeric(12,2)`. Телефоны храним нормализованными (E.164) + отображаемое значение.

## 2. Обзор модели

```
profiles (сотрудники) ──────────────┐
clients ──< orders >── devices      │ (manager_id, master_id)
              │
              ├──< order_items        (строки работ и запчастей)
              ├──< order_status_history (append-only)
              ├──< attachments        (фото, файлы)
              ├──< order_documents    (сгенерированные PDF)
              └──< notification_outbox

categories ──< models >── brands
categories ──< field_templates        → devices.custom_fields (JSONB)
statuses ──< status_transitions       (разрешённые переходы)
org_settings (singleton) · notification_rules · audit_log (append-only)
```

## 3. Таблицы

### 3.1. `profiles` — сотрудники
| Колонка | Тип | Примечание |
|---|---|---|
| id | uuid PK | = `auth.users.id` |
| full_name | text NOT NULL | |
| phone | text | |
| role | text FK → roles | `admin` / `manager` / `master`; зеркало `app_metadata.role` из JWT |
| is_active | boolean DEFAULT true | увольнение = деактивация, история сохраняется |

Роль для RLS читается из JWT (`auth.jwt()->'app_metadata'->>'role'`) — без join; таблица нужна для UI (списки «мастер», «менеджер»). Синхронизацию JWT ↔ таблица делает админская RPC.

### 3.2. `org_settings` — настройки организации (singleton, id=1)
Название, ИНН, адрес, телефон, режим работы, контакты для публичной QR-страницы, `order_prefix` (default `L`), `default_warranty_days`, тексты-дисклеймеры для квитанции, политика хранения фото. Read — все сотрудники, write — админ.

### 3.3. `clients`
| Колонка | Тип | Примечание |
|---|---|---|
| name | text NOT NULL | |
| phone | text NOT NULL | E.164: `+79991234567` |
| phone_display | text | как ввели |
| messenger | text | свободное поле из постановки |
| email | text | CHECK формата |
| comment | text | |
| telegram_chat_id | bigint | заполняется webhook'ом после opt-in |
| deleted_at / deleted_by | | soft delete |

Дубли по телефону **разрешены, но подсвечиваются** (поиск при создании заказа предлагает существующего клиента) — жёсткий UNIQUE по телефону ломает реальные кейсы (общий телефон семьи/организации). Как в Workpan: телефон — основной ключ поиска.

### 3.4. Справочник: `categories`, `brands`, `models`
- `categories`: name (UNIQUE по нормализованному имени), sort, deleted_at. Удаление категории с устройствами — запрещено (только деактивация).
- `brands`: name, name_normalized (UNIQUE) — бренды глобальные, не привязаны к категории (Samsung — и смартфоны, и ТВ).
- `models`: category_id FK, brand_id FK, name, name_normalized; **UNIQUE(category_id, brand_id, name_normalized)** — ключ для upsert при импорте.

`name_normalized` = lower(trim(...)), generated column. Менеджер может быстро создать модель из формы заказа (RPC `quick_add_model`) — иначе нарушим «заказ < 60 сек», когда модели нет в справочнике; полное управление справочником — у админа.

### 3.5. `field_templates` — шаблоны динамических полей
| Колонка | Тип | Примечание |
|---|---|---|
| category_id | uuid FK | |
| key | text | латиница, **immutable** после создания (UNIQUE с category_id) |
| label | text | заголовок в UI, можно менять |
| field_type | text FK → field_types | `text` / `number` / `select` / `multiselect` / `boolean` / `date` |
| options | jsonb | для select: `["вкл","выкл","не проверен"]` |
| is_required | boolean | |
| sort | int | |
| is_active | boolean | деактивация вместо удаления: старые значения живы |

Добавление поля = INSERT строки. **Ни миграций, ни кода** — выполняется требование постановки.

### 3.6. `devices` — устройство (1:1 с заказом)
| Колонка | Тип | Примечание |
|---|---|---|
| category_id / brand_id / model_id | uuid FK | |
| serial_number | text | + нормализованная generated-колонка для поиска |
| completeness | text | комплектация |
| appearance | text | внешнее состояние |
| is_warranty_case | boolean | гарантийный случай |
| custom_fields | jsonb DEFAULT '{}' | `{"imei":"35-...", "apple_id_status":"выключен"}` |

Валидация `custom_fields` — триггером по `field_templates` категории: required при создании заказа, типы и допустимые options — всегда. Устройство создаётся вместе с заказом в одной транзакции (`create_order`), отдельной «картотеки устройств» нет — как в Workpan (повторный ремонт = новый заказ со ссылкой на старый, данные устройства предзаполняются).

### 3.7. `statuses` и `status_transitions` — state machine как данные
- `statuses`: `code` PK (`new`, `accepted`, `diagnostics`, `awaiting_approval`, `awaiting_parts`, `in_repair`, `ready`, `issued`, `declined`, `scrapped`), `label` (рус.), **`color`** (как в Workpan — статусы различаются цветом с одного взгляда), `sort`, `is_terminal`.
- `status_transitions`: `from_code` + `to_code` (PK пара) — таблица переходов из Этапа 1. Функция `change_status()` проверяет наличие пары, иначе exception. Изменение правил = изменение данных (только админ), не деплой.

### 3.8. `orders` — заказ-наряд
| Колонка | Тип | Примечание |
|---|---|---|
| number | bigint | из sequence, конкурентно-безопасно |
| display_number | text UNIQUE | `L-10001`, generated по `org_settings.order_prefix` |
| client_id / device_id | uuid FK | device 1:1 (UNIQUE) |
| status | text FK → statuses | менять **только** через RPC `change_status` (прямой UPDATE поля запрещён триггером) |
| manager_id / master_id | uuid FK → profiles | менеджер ставится автоматически = создавший |
| accepted_at | timestamptz | дата приёма |
| due_date | date | плановая готовность; просрочка = `due_date < today AND status NOT IN (терминальные, ready)` — бейдж в UI как в Workpan |
| claimed_defect | text NOT NULL | заявленная неисправность |
| diagnostic_result | text | результат диагностики |
| master_comment | text | комментарий мастера |
| prepayment | numeric(12,2) DEFAULT 0 | |
| payment_status | text FK | `unpaid` / `prepaid` / `paid` |
| payment_method | text FK | `cash` / `card` / `transfer`, NULL до оплаты |
| warranty_days | int | default из org_settings |
| qr_token | text UNIQUE | 32 hex-символа (128 бит), generated |
| linked_order_id | uuid FK orders | повторный ремонт |
| deleted_at / deleted_by | | |

**Суммы не хранятся**: `works_total`, `parts_total`, `grand_total`, `due_amount` — view `orders_with_totals` (LATERAL-сумма по `order_items`). Нет риска рассинхронизации итога и строк.

«Выполненные работы» из постановки — это строки `order_items` типа `work` (см. ниже), а не текстовое поле: из них собирается акт выполненных работ.

### 3.9. `order_items` — строки работ и запчастей
| Колонка | Тип | Примечание |
|---|---|---|
| order_id | uuid FK | |
| item_type | text | `work` / `part` |
| name | text NOT NULL | |
| price | numeric(12,2) NOT NULL CHECK ≥ 0 | |
| qty | numeric(10,2) NOT NULL DEFAULT 1 CHECK > 0 | |
| deleted_at / deleted_by | | редактирование строк после статуса `issued` запрещено триггером |

Единая таблица для работ и запчастей: одинаковая структура, общий итог, готовые строки для актов (паттерн Workpan «работы и материалы в наряде»).

### 3.10. `order_status_history` — append-only
order_id, from_status, to_status, changed_by, comment, created_at. Триггер запрещает UPDATE/DELETE. Заполняется только из `change_status()`.

### 3.11. `attachments` — файлы
order_id, kind (`device_photo` / `serial_photo` / `document` / `receipt` / `warranty_doc`), storage_path, file_name, mime_type, size_bytes, uploaded_by, deleted_at. Путь в Storage: `<bucket>/<order_id>/<uuid>.<ext>` — политики бакета проверяют права по заказу.

### 3.12. `order_documents` — сгенерированные PDF
order_id, doc_type (`intake_receipt` / `work_act` / `issue_act` / `warranty_card`), storage_path, **snapshot jsonb** — данные, из которых собран PDF, на момент генерации. Денормализация сознательная: выданный клиенту документ должен быть воспроизводим byte-to-byte, даже если данные заказа потом правили.

### 3.13. `notification_outbox`
| Колонка | Тип | Примечание |
|---|---|---|
| event_key | text UNIQUE | `<order_id>:<event>:<channel>` — физическая идемпотентность |
| order_id / event_type / channel | | каналы: `telegram` / `email` / **`phone_call`** |
| recipient | text | chat_id или email; для phone_call — номер |
| payload | jsonb | данные для шаблона |
| status | text | `pending` / `sent` / `failed` / `skipped` (канал не подключён) / `manual_done` |
| attempts / next_retry_at / last_error / sent_at | | backoff: 1м → 5м → 30м → failed |

`phone_call` — ручной канал (UX-N1/Р10): событие создаёт задачу «позвонить», менеджер закрывает её кнопкой → `manual_done`, фиксируется кто и когда.

### 3.14. `notification_rules`
event_type + channel → enabled, template (text с плейсхолдерами `{order_number}`, `{status}`...). Админ включает/выключает события и правит тексты без деплоя. События — 7 из постановки.

### 3.15. `audit_log` — append-only
table_name, record_id, action (`INSERT`/`UPDATE`/`DELETE`-как-soft), actor_id, **changed jsonb** — только diff (старое/новое по изменённым полям, а не полные строки — экономия в 500 MB Free tier), created_at. Триггеры на: orders, clients, devices, order_items, field_templates, org_settings, profiles, справочники. Запрет UPDATE/DELETE триггером; INSERT — только из триггерных функций.

## 4. Стратегия динамических полей — решение и обоснование

**Выбрано: шаблоны (`field_templates`) + значения в `devices.custom_fields` JSONB + валидирующий триггер.**

| Критерий | JSONB + шаблоны (выбрано) | Классический EAV | Колонки по ALTER TABLE |
|---|---|---|---|
| Чтение устройства | 1 строка | join значений + pivot | 1 строка |
| Новое поле | INSERT в шаблоны | INSERT | миграция + деплой |
| Типобезопасность | триггер по шаблону | слабая (всё text) | сильная |
| Поиск по полю | GIN по custom_fields | индекс по value | btree |
| Риск | расхождение с шаблоном → закрыт триггером | «расползание», 3 join'а | админ не может сам |

Правила, закрывающие слабые места JSONB: `key` immutable; деактивация поля не трогает старые значения; триггер отклоняет ключи, которых нет в шаблонах категории; `required` проверяется при создании, а не при каждом обновлении (чтобы старые заказы не блокировали правки).

## 5. Индексация

| Таблица | Индекс | Зачем |
|---|---|---|
| models | GIN `name_normalized gin_trgm_ops`; btree (category_id, brand_id) | автодополнение по 10⁴–10⁵ моделей |
| brands | GIN trgm по name_normalized | автодополнение |
| clients | GIN trgm по name; btree phone; GIN trgm по phone | поиск «по куску номера» — главный сценарий Workpan |
| devices | btree serial_normalized + GIN trgm | поиск по серийнику |
| orders | btree display_number; UNIQUE qr_token; btree (status, due_date); btree master_id, manager_id, client_id, accepted_at | таблица заказов, фильтры, виджеты |
| order_items | btree order_id (partial: deleted_at IS NULL) | суммы заказа |
| notification_outbox | partial btree (next_retry_at) WHERE status='pending' | выборка cron'а — только хвост очереди |
| audit_log | btree (table_name, record_id); BRIN created_at | история записи; дешёвый индекс по времени |
| Все soft-delete таблицы | partial-индексы с `WHERE deleted_at IS NULL` | живые данные — быстрые, мёртвые — не мешают |

Глобальный поиск (одна строка поиска: номер заказа / телефон / имя / серийник / бренд / модель — как в Workpan) — RPC `global_search(q)`: UNION по сущностям с trigram-ранжированием, LIMIT по группам.

## 6. Workpan-паттерны, отражённые в модели

| Привычка Workpan | Где в модели |
|---|---|
| Заказ-наряд — центр всего | §1, всё FK на orders |
| Цветные статусы | `statuses.color` |
| Бейдж просрочки | вычисление от `due_date` в view |
| Работы и материалы строками в наряде | `order_items` |
| Поиск по куску телефона/номера | trigram-индексы, `global_search` |
| Повторный ремонт со связью | `linked_order_id` + предзаполнение |
| Быстрое добавление модели из наряда | `quick_add_model` |

## 7. Риски и открытые вопросы

- **JSONB-поиск по custom_fields** (например, «найти по IMEI»): IMEI попадает в глобальный поиск через GIN-индекс по `custom_fields` — добавлен в этап SQL.
- **Audit diff на JSONB-полях** даёт крупные записи при правке custom_fields — приемлемо, diff и так покомпонентный.
- **Лимит 500 MB**: расчётная ёмкость при 300 заказах/мес ≈ 8–10 МБ/год по основным таблицам + аудит ≈ 20–30 МБ/год. Запас на годы.

## 8. Что будет на следующем этапе

**Этап 4 — ER-диаграмма** в Mermaid: все таблицы §3 со связями и ключами, одним артефактом.

## 9. ⏸️ СТОП

Жду подтверждения для перехода к Этапу 4.
