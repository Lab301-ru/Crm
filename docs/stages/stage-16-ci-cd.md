# ЭТАП 16: CI/CD (GitHub Actions)

> Статус: **на утверждении**.
> Проверено: YAML обоих workflow валиден; все шаги CI — это те же команды, что уже зелёные локально (`npm run typecheck/build`, `scripts/test-db.sh` — 28 проверок + демо, `deno test`).

---

## 1. CI — на каждый push и pull request (`.github/workflows/ci.yml`)

Три независимых джоба (падают и чинятся по отдельности):

| Джоб | Что делает |
|---|---|
| **frontend** | `npm ci` → `tsc` strict → `vite build` (PWA собирается с placeholder-ключами — реальные секреты в CI-сборке не нужны и не светятся) |
| **db-tests** | контейнер `postgres:16` → `scripts/test-db.sh 127.0.0.1 5432`: все 10 миграций + seed с нуля, RLS 15 проверок, бизнес-логика 13 проверок, демо-данные как интеграционный тест |
| **edge-functions** | `deno test` шаблонов уведомлений + `deno check` всех четырёх функций (типы) |

Ключевой принцип: **CI не имеет собственной логики** — он запускает ровно те же скрипты, что разработчик локально. Нечему расходиться.

## 2. CD бэкенда (`.github/workflows/deploy-backend.yml`)

Деплой в облачный Supabase при изменениях `supabase/**` в `main` (или вручную — `workflow_dispatch`):

1. `supabase link --project-ref …`
2. `supabase db push` — применяет только новые миграции (state хранит сам Supabase)
3. `supabase functions deploy` — все Edge Functions

`concurrency: deploy-backend` — два деплоя не наложатся друг на друга.

**Секреты репозитория** (Settings → Secrets and variables → Actions):

| Секрет | Откуда |
|---|---|
| `SUPABASE_ACCESS_TOKEN` | https://supabase.com/dashboard/account/tokens |
| `SUPABASE_PROJECT_REF` | Dashboard → Settings → General |
| `SUPABASE_DB_PASSWORD` | Dashboard → Settings → Database |

## 3. CD фронтенда — git-интеграция хостинга, не Actions

Статику деплоит сам хостинг по push в `main` — это проще, бесплатно и даёт preview-деплои для веток:

- **Vercel / Netlify / Cloudflare Pages**: подключить репозиторий, build command `npm run build`, output `dist`, переменные `VITE_SUPABASE_URL` и `VITE_SUPABASE_ANON_KEY` — в настройках проекта хостинга.
- SPA-fallback: Vercel и CF Pages понимают SPA сами; для Netlify добавить редирект `/* → /index.html 200` (войдёт в инструкцию Этапа 17).
- Self-hosted альтернатива — `Dockerfile` Этапа 14.

## 4. Порядок выкатки изменений (зачем такой)

1. Push в ветку → CI зелёный → merge в `main`.
2. `deploy-backend` применяет миграции **раньше**, чем хостинг успевает собрать фронтенд, — новые колонки/RPC уже на месте к моменту обновления интерфейса. Обратный порядок (фронт раньше базы) не страшен: интерфейс не знает о новых полях.
3. Откат: фронтенд — redeploy предыдущего билда в хостинге; миграции вперёд-только (новая корректирующая миграция, не откат).

## 5. Риски и открытые вопросы

- `supabase db push` на живой базе: миграции уже написаны идемпотентно (`on conflict do nothing`, `create or replace`), но порядок «сначала база, потом фронт» остаётся правилом.
- Деплой функций перезапускает изоляты — in-memory rate-limit `public-status` обнулится; это штатно (best effort с Этапа 6).
- CI на каждый push любой ветки — при активной разработке это минуты Actions; для приватного репозитория лимит бесплатных минут 2000/мес, расход ~5 мин/push — запас большой.

## 6. Что будет на следующем этапе

**Этап 17 — Деплой и ввод в эксплуатацию:** пошаговая инструкция с нуля до работающей системы — проект Supabase, секреты, бакеты, pg_cron для notify-dispatch, хостинг фронтенда, bootstrap первого админа, заполнение реквизитов, Telegram-бот, проверочный чек-лист.

## 7. ⏸️ СТОП

Жду подтверждения для перехода к Этапу 17.
