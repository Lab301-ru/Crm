# ЭТАП 6: Backend — REST API и Edge Functions

> Статус: **на утверждении**.
> Бизнес-логика и state machine реализованы на Этапе 5 в БД (это было ключевое архитектурное решение Р2 — их невозможно обойти). Этот этап добавляет слой доставки: карту REST API и три Edge Functions (typecheck Deno — чисто). `pdf-generate` сознательно не создан заглушкой — он целиком пишется на Этапе 11 (правило «без заглушек»).

---

## 1. Карта REST API

Базовый URL: `https://<project>.supabase.co`. Все запросы сотрудников: заголовки `apikey: <anon key>` + `Authorization: Bearer <JWT>`.

### 1.1. Чтение (PostgREST, под RLS)

| Сценарий | Запрос |
|---|---|
| Главная таблица заказов | `GET /rest/v1/order_list?order=accepted_at.desc&limit=25&offset=0` |
| Фильтры (статус, мастер, менеджер, дата, категория, бренд) | `&status=eq.in_repair` · `&master_id=eq.<uuid>` · `&manager_id=eq.<uuid>` · `&accepted_at=gte.2026-06-01` · `&category_id=eq.<uuid>` · `&brand_id=eq.<uuid>` |
| Карточка заказа с суммами | `GET /rest/v1/orders_with_totals?id=eq.<uuid>` |
| Строки работ/запчастей | `GET /rest/v1/order_items?order_id=eq.<uuid>&deleted_at=is.null&order=created_at` |
| История статусов | `GET /rest/v1/order_status_history?order_id=eq.<uuid>&order=created_at` |
| Автодополнение моделей (trigram-индекс) | `GET /rest/v1/models?category_id=eq.<uuid>&name_normalized=ilike.*iphone*&select=id,name,brands(name)&limit=10` |
| Поиск клиента по телефону при приёмке | `GET /rest/v1/clients?phone=like.*99912345*&deleted_at=is.null&limit=5` |
| Справочники, шаблоны полей, статусы, сотрудники | `GET /rest/v1/{categories,brands,field_templates,statuses,profiles}?...` |
| Задачи «позвонить клиенту» | `GET /rest/v1/notification_outbox?channel=eq.phone_call&status=eq.pending` |
| Файлы заказа | `GET /rest/v1/attachments?order_id=eq.<uuid>&deleted_at=is.null` |

Пагинация — `limit/offset` (+ `Prefer: count=exact` для общего числа страниц).

### 1.2. Запись

Простые правки — PostgREST `PATCH`/`POST` под RLS (клиенты, строки заказа, поля заказа кроме `status`, справочники для админа, soft delete через `PATCH {deleted_at: now}`). Транзакционные сценарии — только RPC:

| RPC | Кто | Что делает |
|---|---|---|
| `POST /rest/v1/rpc/create_order` | admin, manager | клиент + устройство + заказ + строки одной транзакцией; → `{id, display_number, qr_token}` |
| `POST /rest/v1/rpc/change_status` | staff (мастер — свои) | единственная дверь state machine; история + outbox |
| `POST /rest/v1/rpc/quick_add_model` | admin, manager | бренд+модель из формы приёмки |
| `POST /rest/v1/rpc/import_catalog_batch` | admin | пачка ≤500 строк, построчный отчёт |
| `POST /rest/v1/rpc/global_search` | staff | единая строка поиска |
| `POST /rest/v1/rpc/dashboard_stats` | staff | 6 виджетов (выручка — только admin/manager) |
| `POST /rest/v1/rpc/mark_phone_call_done` | staff | закрыть задачу «позвонить» |

**Формат ошибок:** `raise exception` в БД → HTTP 400 с `{message: "Переход \"ready\" → \"accepted\" запрещён"}` — русские сообщения из БД показываются в UI как есть.

### 1.3. Edge Functions

| Endpoint | Auth | Назначение |
|---|---|---|
| `POST /functions/v1/notify-dispatch` | service_role | разобрать outbox (вызывает pg_cron и SPA после смены статуса — best effort) |
| `GET /functions/v1/public-status?token=<hex32>` | нет | публичная QR-страница |
| `POST /functions/v1/telegram-webhook` | секретный заголовок Telegram | opt-in подписки клиентов |
| `POST /functions/v1/pdf-generate` | JWT сотрудника | генерация PDF (Этап 11) |

## 2. Артефакты

```
supabase/
├── config.toml                          # verify_jwt по функциям
└── functions/
    ├── _shared/
    │   ├── env.ts                       # requireEnv/optionalEnv
    │   ├── admin.ts                     # service-клиент, проверка service_role, json()
    │   └── template.ts                  # рендер шаблонов уведомлений
    ├── notify-dispatch/index.ts         # Telegram + SMTP (nodemailer), claim/complete
    ├── public-status/index.ts           # rate limit 30/мин/IP, валидация токена, CORS
    └── telegram-webhook/index.ts        # /start <qr_token> → link_telegram + ответы клиенту
```

## 3. Ключевые решения

- **Уведомления тянет БД, а не функция.** `notify-dispatch` — тонкий доставщик: `claim_notifications()` (SKIP LOCKED) → отправка → `complete_notification()` (backoff в SQL). Функция может упасть в любом месте — недоставленное заберёт следующий запуск. Двойная отправка исключена клеймом, двойная постановка — `event_key UNIQUE`.
- **SMTP через `npm:nodemailer`** вместо deno.land-библиотек: официально поддержан в Supabase Edge Runtime, живая поддержка, типы. Любой SMTP-провайдер конфигурацией (A11).
- **Telegram-подписка по deep-link:** в квитанции печатается `https://t.me/<bot>?start=<qr_token>` — клиент нажимает один раз, бот получает `/start <токен>`, `link_telegram()` привязывает chat_id. Подлинность вебхука — заголовок `X-Telegram-Bot-Api-Secret-Token` (стандартный механизм `setWebhook`).
- **`public-status`:** проверка формата токена до похода в БД, rate limit 30 запросов/мин/IP (token bucket в памяти изолята — best effort, честно задокументировано), `Cache-Control: no-store`, в ответе — только белый список полей из `public_order_status()`.
- **`notify-dispatch` защищён сравнением Bearer-токена с service-ключом** — pg_cron шлёт его в заголовке; «дёрнуть» доставку снаружи нельзя.

## 4. Секреты (supabase secrets set)

| Переменная | Назначение |
|---|---|
| `TELEGRAM_BOT_TOKEN` | токен бота от @BotFather |
| `TELEGRAM_WEBHOOK_SECRET` | свой случайный секрет для setWebhook |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USERNAME` / `SMTP_PASSWORD` / `SMTP_FROM` | почтовый провайдер |
| `PUBLIC_APP_URL` | базовый URL SPA для ссылок `{tracking_url}` |

`SUPABASE_URL` и `SUPABASE_SERVICE_ROLE_KEY` доступны в Edge Functions автоматически.

## 5. Проверено

- `deno check` (strict) — все три функции и shared-модули без ошибок.
- SQL-контракт функций (`claim_notifications`, `complete_notification`, `link_telegram`, `public_order_status`) проверен живым тестом на Этапе 5.

## 6. Риски и открытые вопросы

- Rate limit в памяти изолята обнуляется при перезапуске — для МVP достаточно (главная защита — энтропия токена); при необходимости заменяется на счётчик в БД.
- Интеграционный тест отправки Telegram/SMTP возможен только с реальными секретами — войдёт в чек-лист деплоя (Этап 17).

## 7. Что будет на следующем этапе

**Этап 7 — Frontend:** структура React-приложения, роутинг, управление состоянием (TanStack Query), ключевые экраны (таблица заказов, карточка, приёмка <60 сек, дашборд, справочники, настройки), UI-кит в духе Workpan.

## 8. ⏸️ СТОП

Жду подтверждения для перехода к Этапу 7.
