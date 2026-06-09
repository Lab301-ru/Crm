# ЭТАП 5: SQL-схема

> Статус: **на утверждении**.
> Артефакты — не фрагменты в документе, а **рабочие файлы миграций** в `supabase/migrations/` + `supabase/seed.sql`. Вся схема **проверена на живом PostgreSQL 16**: миграции применяются без ошибок, функциональный smoke-тест пройден (см. §3).

---

## 1. Состав артефактов

| Файл | Содержимое |
|---|---|
| `migrations/20260609100001_extensions.sql` | pg_trgm, pgcrypto, pg_cron/pg_net (с мягкой деградацией), `normalize_phone()`, `set_updated_at()`, `app_role()` |
| `migrations/20260609100002_tables.sql` | Все 18 таблиц модели Этапа 3/4, sequence номеров заказов, updated_at-триггеры |
| `migrations/20260609100003_triggers.sql` | Аудит (jsonb-diff), запрет физического DELETE, append-only история/аудит, нормализация телефона, неизменяемость key/типа шаблонов полей, валидация custom_fields, дефолты заказа, защита поля status, контроль soft delete, блокировка состава закрытого заказа |
| `migrations/20260609100004_functions.sql` | Проверки ролей, `fn_enqueue_notifications`, `change_status`, `create_order`, `quick_add_model`, `import_catalog_batch`, view `orders_with_totals` и `order_list`, `global_search`, `dashboard_stats`, `mark_phone_call_done`, функции для Edge (`claim_notifications`, `complete_notification`, `link_telegram`, `public_order_status`), права на функции |
| `migrations/20260609100005_indexes.sql` | Trigram/GIN-индексы поиска, partial-индексы living-данных, partial-индекс очереди outbox, BRIN аудита |
| `migrations/20260609100006_rls.sql` | RLS на всех 18 таблицах: admin / manager / master; анонимам — ничего |
| `seed.sql` | 10 статусов с цветами (Workpan), 22 перехода state machine, 15 правил уведомлений с русскими шаблонами, настройки организации, 4 демо-категории с доп-полями из постановки |

## 2. Ключевые решения

- **`change_status()` — единственная дверь state machine.** Прямой `UPDATE orders.status` блокируется триггером (транзакционный флаг `app.status_change` ставит только функция). Переходы проверяются по таблице `status_transitions`; админ может делать внеплановые переходы (фиксируются в истории). Повторный вызов с тем же статусом — no-op.
- **Идемпотентность уведомлений физическая:** `event_key UNIQUE (order:event:channel)` + `ON CONFLICT DO NOTHING`; забор очереди — `FOR UPDATE SKIP LOCKED`; backoff 1м → 5м → 30м → `failed`. Канал без получателя (нет chat_id/email) сразу помечается `skipped`.
- **Security definer только там, где нужно:** RPC с явными проверками роли внутри; функции для Edge Functions отозваны у `anon`/`authenticated` и выданы только `service_role`. `public_order_status()` возвращает строго белый список полей.
- **Аудит — компактный diff** только изменённых полей (не полные строки) — экономия в рамках 500 MB Free tier; `record_id text` (ключи бывают uuid и int — отступление от ER, помечено).
- **Колонка `orders.public_comment` добавлена** (выявлено на этом этапе): «комментарий сервиса» публичной QR-страницы должен быть отдельным полем, а не комментарием мастера — мастерские заметки клиенту видеть нельзя.
- **Required-поля проверяются только при приёмке** (INSERT устройства): новое обязательное поле в шаблоне не блокирует правки старых заказов.

## 3. Проверка на PostgreSQL 16 (результаты)

Шим `auth`-схемы Supabase (auth.users, auth.uid(), auth.jwt(), роли anon/authenticated/service_role) → все 6 миграций + seed применены без ошибок. Smoke-тест:

| Проверка | Результат |
|---|---|
| `quick_add_model` + `create_order` одной транзакцией (клиент+устройство+заказ+строки) | ✅ заказ `L-10001`, телефон нормализован `8 (999)...` → `+79991234567` |
| Outbox после приёмки: telegram → `skipped` (нет chat_id), email → `pending` | ✅ |
| Прямой `UPDATE orders.status` | ✅ заблокирован |
| Невалидный переход `accepted → issued` (менеджер) | ✅ отклонён |
| Цепочка `diagnostics → awaiting_approval → in_repair → ready` | ✅ 5 записей истории, события в outbox по правилам (включая задачи «позвонить») |
| Повторная смена на тот же статус | ✅ no-op, история не растёт |
| Неизвестный ключ в custom_fields; select-значение вне списка | ✅ оба отклонены |
| Суммы view: работы 5000 + запчасти 12000 − предоплата 1000 | ✅ grand_total 17000, due 16000 |
| `global_search`: по куску телефона «123-45», по IMEI в JSONB, по «iphone» | ✅ все три находят заказ с указанием причины совпадения |
| Физический `DELETE` | ✅ запрещён |
| Аудит | ✅ INSERT/UPDATE по всем таблицам, diff-формат |
| `import_catalog_batch` (дубль + пустая строка) | ✅ `{inserted:1, skipped:1, errors:[{row:3,...}]}`; без роли admin — отказ |
| `public_order_status` | ✅ только белый список полей |

## 4. Риски и открытые вопросы

- Расписание pg_cron (вызов `notify-dispatch` раз в минуту) задаётся на этапе деплоя — требует URL проекта и ключа (это конфигурация, не схема).
- RLS-политики проверены логически и через definer-функции; полный матричный тест ролей через PostgREST-контекст — на этапе 16 (Тестирование).

## 5. Что будет на следующем этапе

**Этап 6 — Backend:** карта REST API (PostgREST-эндпоинты + RPC), четыре Edge Functions полностью (`notify-dispatch` с Telegram/SMTP, `public-status` с rate limiting, `telegram-webhook`, заготовка `pdf-generate`), формат конфигурации (env/секреты).

## 6. ⏸️ СТОП

Жду подтверждения для перехода к Этапу 6.
