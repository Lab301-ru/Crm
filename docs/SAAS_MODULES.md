# UltraCRM → SaaS: модули и архитектура

Документ описывает доработки, превращающие UltraCRM в коммерческую SaaS CRM,
и их реализацию **в фактическом стеке проекта**: Supabase (PostgreSQL + RLS +
Deno Edge Functions + Storage) на бэкенде и Vite + React 19 + TanStack Query на
фронтенде. Это не Next.js/Prisma/Redis из обобщённого ТЗ — паттерны адаптированы
без переписывания рабочего приложения.

## Архитектура (как есть)

```
React (Vite, PWA)  ──HTTPS──►  Supabase
  features/*                     ├─ PostgREST  (таблицы + RLS)
  shared/api/* (слой доступа)    ├─ RPC        (security-definer функции = service layer)
  TanStack Query (кэш)           ├─ Storage    (приватные бакеты, signed URL)
                                 └─ Edge Functions (Deno): telegram-webhook,
                                                    notify-dispatch, public-status
```

- **Чистая архитектура** реализована как: `features/*` (UI) → `shared/api/*`
  (репозитории/клиент) → SQL-функции `security definer` (сервисы/доменная логика)
  → таблицы под RLS. Бизнес-инварианты (state machine, аудит, soft delete,
  идемпотентность уведомлений) живут в БД — это надёжнее, чем в контроллерах.
- **Очередь уведомлений** — паттерн transactional outbox (`notification_outbox`)
  + cron-диспетчер (`notify-dispatch`), а не Redis/BullMQ. Для SaaS этого
  масштаба надёжнее (нет второго стораджа, идемпотентность через `event_key`,
  backoff-ретраи в `complete_notification`).

---

## 1. Telegram-уведомления (готово в проекте)

Событийная доставка уже была реализована; статусы «принят»/«выдан» покрыты:

- `change_status()` при переходе в `accepted` → событие `order_accepted`,
  в `issued` → `order_issued`; `fn_enqueue_notifications` кладёт сообщение в
  `notification_outbox` (идемпотентно по `event_key`).
- `notify-dispatch` (cron) забирает пачку через `claim_notifications`
  (`FOR UPDATE SKIP LOCKED`), шлёт через Telegram Bot API, фиксирует результат
  `complete_notification` с экспоненциальным backoff.
- `telegram-webhook` обрабатывает `/start <qr_token>` (привязка клиента) и
  `/start <OWNER_SETUP_CODE>` (привязка владельца).

Правила и каналы настраиваются в `notification_rules` (UI: Настройки).

## 2. Модуль «Запчасти» — `order_parts`

Миграция `20260621110001_parts.sql`. Отдельная сущность от `order_items`
(строки чека): здесь ведётся **закупка** детали.

- Статусы: `need_order` (нужно заказать) → `ordered` (заказано/ожидаем) →
  `received` (получено); `ordered_at`/`received_at` проставляются триггером.
- Поля: `name`, `shop_url` (ссылка на магазин, валидируется `^https?://`),
  `cost`, `qty`, `note`.
- Квитанция поставщика — файл в приватном бакете `documents` по пути
  `<order_id>/parts/<uuid>.<ext>`; добавлена storage-политика
  `storage_docs_insert_staff` (раньше туда писал только service_role).
- RLS — через видимость заказа (мастер ведёт закупку своих заказов; soft delete
  — менеджер/админ).
- UI: `features/orders/PartsCard.tsx` на странице заказа.

API: `shared/api/parts.ts`.

## 3. Аналитика — `analytics_stats(period)`

Миграция `20260621110002_analytics.sql`. Фильтр `period`: `month` | `all`.
Возвращает: топ-10 ремонтов (по строкам работ выданных заказов), средний и
максимальный чек, выручку, количество заказов, топ-10 клиентов по сумме оплат.
UI: `features/analytics/AnalyticsPage.tsx` (раздел «Аналитика»).

## 4. Финансовый модуль — `expenses` + `finance_overview(period)`

Миграция `20260621110003_expenses.sql`.

- Таблица `expenses`: категории `parts, salary, rent, ads, courier, outsource,
  digital, other`, `amount`, `spent_on`, опциональная связь `order_id`. RLS —
  только менеджер/админ.
- `finance_overview(period)` (`today|month|year|all`): выручка (из выданных
  заказов), расходы за период, **чистая прибыль = выручка − расходы**,
  **маржинальность = прибыль/выручка**, разбивка расходов по категориям.
- Выручка/валовая прибыль по запчастям (`order_items.cost_price`) по-прежнему в
  `finance_stats()` — это отдельная метрика; `finance_overview` оперирует
  операционными расходами из `expenses`.
- UI: разделы «Финансы» и «Расходы» на странице Аналитики.

## 5. PDF-квитанции — автоподстановка подписанта

Миграция `20260621110004_receipt_signer.sql`. Печатная форма рендерится в
браузере (HTML → «Сохранить как PDF»), снимок воспроизводим из `order_documents`.
Добавлены `org_settings.receipt_signer_name` (по умолчанию **«Юрий»**) и
`receipt_signer_signature` (**«Б.Ю.Г.»**); на стороне сервиса в подписях
автоматически проставляются факсимиле-подпись и расшифровка. Настраивается в
Настройках. UI: `features/orders/PrintDocumentPage.tsx`.

> Если потребуется серверная генерация PDF-файла (например, чтобы прикладывать
> PDF к email/Telegram), добавляется Edge Function на `@react-pdf/renderer` или
> headless-рендер; колонка `order_documents.storage_path` под это уже
> зарезервирована.

---

## 6. SaaS мультиаккаунты (multi-tenant) — план, требует согласования

Текущая схема **одно-арендная** (`org_settings` — singleton, `profiles` 1:1 с
`auth.users`, нет `company_id`). Перевод живой БД в multi-tenant — крупная и
необратимая миграция, поэтому вынесен отдельным согласуемым этапом, а не
сделан вслепую. Рекомендуемый подход — **shared-схема + `company_id` + RLS**
(дёшево масштабируется на Supabase, изоляция на уровне строки).

### Модель

```
companies (id, name, plan, created_at, ...)
company_members (company_id, user_id, role)   -- заменяет profiles.role
   ▼ company_id добавляется во ВСЕ доменные таблицы:
clients, devices, orders, order_items, order_parts, expenses,
categories/brands/models, field_templates, attachments, order_documents,
notification_rules, notification_outbox, statuses(?), audit_log
org_settings → строка на компанию (PK company_id вместо singleton id=1)
```

### Шаги миграции (безопасный backfill)

1. `companies` + `company_members`; создать одну компанию «по умолчанию»,
   импортировать в неё всех текущих `profiles`.
2. `company_id uuid` на все доменные таблицы (сначала NULLABLE), backfill = id
   компании по умолчанию, затем `SET NOT NULL` + FK + индексы по `company_id`.
3. Хелпер `auth_company_id()` (`security definer`, читает `company_members` по
   `auth.uid()`), кэш через `current_setting`.
4. Переписать **каждую** RLS-политику: добавить `company_id = auth_company_id()`
   к существующим ролевым условиям. Это самая объёмная и рискованная часть —
   обязателен прогон `supabase/tests/rls_test.sql`, расширенного на кросс-tenant
   попытки доступа.
5. Сервис-функции (`create_order`, `change_status`, `finance_*`, `analytics_*`,
   `*_stats`) — проставлять/фильтровать по `company_id`; снять зависимость от
   `org_settings.id = 1`.
6. `order_number_seq` → пер-компанийная нумерация (таблица счётчиков на
   `company_id` вместо глобального sequence).
7. JWT tenant context: класть `company_id` в `app_metadata` при онбординге;
   на клиенте — выбор активной компании, в API — заголовок/клейм.
8. Биллинг: `plan`/лимиты на `companies`, вебхуки платёжного провайдера в Edge
   Function.

### Почему отдельно

Пункты 4–6 трогают каждую политику и функцию рабочего приложения; ошибка =
утечка данных между арендаторами. Нужны: бэкап, прогон RLS-тестов на кросс-tenant
сценарии и явное решение по стратегии нумерации заказов. Готов выполнить отдельным
PR после согласования модели.

---

## Деплой SaaS (рекомендации)

- **БД/бэкенд:** Supabase (managed Postgres + Auth + Storage + Edge Functions).
  Миграции — `supabase db push` из CI; секреты (`TELEGRAM_BOT_TOKEN`,
  `OWNER_SETUP_CODE`, `APP_URL`) — в Supabase Function secrets.
- **Cron:** `notify-dispatch` по расписанию (`supabase/cron_setup.sql`,
  pg_cron / Scheduled Functions) — доставка outbox раз в минуту.
- **Фронтенд:** статика на Vercel/Netlify (`vercel.json` уже есть, SPA-rewrite),
  PWA-кэш через vite-plugin-pwa.
- **Масштабирование:** read-replica для аналитики; вынести тяжёлые отчёты в
  материализованные представления с обновлением по cron; Storage на S3-совместимом
  бэкенде Supabase. При multi-tenant — connection pooling (Supavisor) обязателен.
- **Изоляция/безопасность:** вся доменная логика под RLS; публичные данные —
  только через Edge Function + service_role; приватные бакеты + signed URL.
- **Наблюдаемость:** `audit_log` (уже есть) + логи Edge Functions; алерты на
  `notification_outbox.status='failed'`.
