# Развёртывание с нуля до работающей системы

Время: ~40–60 минут. Стоимость: **0 ₽/мес** (Supabase Free + бесплатный хостинг статики).

Понадобятся: аккаунт [Supabase](https://supabase.com), аккаунт GitHub, аккаунт хостинга статики (Vercel / Netlify / Cloudflare Pages — любой), установленный [Supabase CLI](https://supabase.com/docs/guides/local-development) и `git`.

---

## 1. Проект Supabase

1. https://supabase.com/dashboard → **New project**: имя (например `crm`), регион **EU (Frankfurt)** (ближе к РФ), сгенерировать и **сохранить пароль базы**.
2. Дождаться создания (~2 мин). Выписать из **Settings → API**:
   - `Project URL` → это `VITE_SUPABASE_URL`
   - `anon public` ключ → `VITE_SUPABASE_ANON_KEY`
   - `service_role` ключ (секретный — никому и никогда во фронтенд)
   - **Settings → General** → `Reference ID` → это `<PROJECT_REF>`

## 2. База: миграции и seed

```bash
git clone <ваш форк репозитория> && cd Crm
supabase login                      # откроет браузер
supabase link --project-ref <PROJECT_REF>   # спросит пароль базы
supabase db push                    # применит все 10 миграций
```

Seed (статусы, переходы, правила уведомлений, шаблоны полей) — `db push` его **не** применяет:

```bash
psql "postgresql://postgres:<ПАРОЛЬ>@db.<PROJECT_REF>.supabase.co:5432/postgres" \
  -f supabase/seed.sql
```

(или скопировать содержимое `supabase/seed.sql` в Dashboard → SQL Editor → Run; seed идемпотентен — повторный запуск безопасен).

## 3. Edge Functions и их секреты

```bash
supabase functions deploy           # все 4 функции

supabase secrets set \
  PUBLIC_APP_URL=https://crm.example.com \
  TELEGRAM_BOT_TOKEN=123456:ABC-DEF... \
  TELEGRAM_WEBHOOK_SECRET=$(openssl rand -hex 24) \
  SMTP_HOST=smtp.yandex.ru \
  SMTP_PORT=465 \
  SMTP_USERNAME=crm@example.com \
  SMTP_PASSWORD=... \
  SMTP_FROM="Сервисный центр <crm@example.com>"
```

| Секрет | Зачем | Где взять |
|---|---|---|
| `PUBLIC_APP_URL` | ссылки `/status/<token>` в уведомлениях | адрес фронтенда из шага 6 (можно задать позже) |
| `TELEGRAM_BOT_TOKEN` | бот уведомлений | шаг 5 |
| `TELEGRAM_WEBHOOK_SECRET` | защита вебхука | сгенерировать (`openssl rand -hex 24`) |
| `SMTP_*` | email-уведомления | почтовый провайдер (Яндекс 360, Mail.ru — пароль приложения, не основной) |

Telegram или SMTP можно не настраивать вовсе: правила этих каналов просто выключаются в **Настройки → Уведомления** внутри CRM.

## 4. Расписание доставки уведомлений (pg_cron)

Dashboard → **SQL Editor** → вставить содержимое `supabase/cron_setup.sql`, подставив `<PROJECT_REF>` и `<SERVICE_ROLE_KEY>` → Run. Проверка: `select * from cron.job;` — должна быть строка `notify-dispatch-every-minute`.

## 5. Telegram-бот (если нужен канал Telegram)

1. В Telegram: **@BotFather** → `/newbot` → имя/username → получить токен (он уже в секретах шага 3).
2. Привязать вебхук (подставить свои значения):

```bash
curl "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/setWebhook" \
  -d "url=https://<PROJECT_REF>.supabase.co/functions/v1/telegram-webhook" \
  -d "secret_token=<TELEGRAM_WEBHOOK_SECRET>"
```

3. Как подключаются клиенты: бот привязывается ссылкой `t.me/<бот>?start=<токен_заказа>` — токен тот же, что в QR отслеживания (карточка заказа → «Отслеживание для клиента»). Менеджер отправляет ссылку клиенту любым способом; клиент нажимает **Start** — бот связывает его chat_id с карточкой клиента, и уведомления о готовности уходят сами.

## 6. Фронтенд (Vercel / Netlify / Cloudflare Pages)

На примере Vercel (другие — аналогично):

1. **Add New Project** → импортировать GitHub-репозиторий.
2. Framework: **Vite**. Build: `npm run build`, Output: `dist` (подставится само).
3. **Environment Variables**:
   - `VITE_SUPABASE_URL` = Project URL
   - `VITE_SUPABASE_ANON_KEY` = anon ключ
4. Deploy → получить адрес вида `https://crm-xxx.vercel.app` (или привязать свой домен).
5. Если выбрали Netlify — SPA-fallback уже в репозитории (`public/_redirects`).
6. Обновить `PUBLIC_APP_URL` в секретах функций (шаг 3), если адрес стал известен только сейчас.

Self-hosted альтернатива: `docker build -t crm-web --build-arg VITE_SUPABASE_URL=... --build-arg VITE_SUPABASE_ANON_KEY=... . && docker run -p 8080:80 crm-web`.

## 7. Auth: адреса и первый администратор

1. Dashboard → **Authentication → URL Configuration**:
   - Site URL = адрес фронтенда
   - Redirect URLs: добавить `https://<адрес>/reset-password`
2. **Authentication → Sign In / Up → Email**: выключить **Enable sign ups** (сотрудников создаёт только админ).
3. **Authentication → Users → Add user**: email + пароль администратора, ✓ Auto Confirm.
4. **SQL Editor** (подставить свой email):

```sql
update auth.users
set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || '{"role":"admin"}'::jsonb
where email = 'admin@example.com';

insert into public.profiles (id, full_name, role)
select id, 'Администратор', 'admin' from auth.users where email = 'admin@example.com';
```

Дальше сотрудники создаются из приложения: **Настройки → Сотрудники → + Сотрудник**.

## 8. Первичная настройка внутри CRM

Войти администратором → **Настройки**:

1. **Организация**: название, ИНН, адрес, телефон, часы работы, префикс заказов (печатается на квитанциях!), гарантия по умолчанию, дисклеймер квитанции.
2. **Уведомления**: включить нужные правила/каналы, поправить тексты шаблонов.
3. **Справочник**: импортировать свои категории/бренды/модели из Excel/CSV (**Справочник → Импорт**, колонки: категория, бренд, модель) — или добавлять на лету при приёмке.
4. **Шаблоны полей**: проверить доп-поля категорий (IMEI, диагональ и т.д.), добавить свои.
5. Создать сотрудников (менеджеры, мастера).

## 9. CI/CD (по желанию, рекомендуется)

GitHub → Settings → Secrets and variables → Actions: добавить `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_REF`, `SUPABASE_DB_PASSWORD`. После этого изменения в `supabase/**` на `main` доезжают до облака сами (Этап 16), фронтенд пересобирает хостинг.

## 10. Проверочный чек-лист (10 минут)

- [ ] Вход администратором работает; «Настройки» видны.
- [ ] **Новый заказ** с телефона: клиент по номеру → категория → бренд/модель (быстрое добавление работает) → неисправность → «Принять» — заказ открылся, номер с вашим префиксом.
- [ ] Фото с камеры телефона загружается, открывается в галерее.
- [ ] Смена статуса по цепочке; в «Готов» — в заказе клиента с email/Telegram появляется уведомление (или задача «позвонить» на дашборде).
- [ ] Печать квитанции: реквизиты, дисклеймер, QR; «Сохранить как PDF» из диалога печати.
- [ ] QR со квитанции открывает публичную страницу: статус, таймлайн, контакты; **в режиме инкогнито** — то же самое (доступ без входа), а сама CRM в инкогнито требует логин.
- [ ] Создать мастера в «Сотрудниках», войти им: видит только свои заказы, не видит финансов и настроек.
- [ ] На телефоне: «Установить приложение» / «На экран Домой» — иконка, полноэкранный запуск; включить авиарежим — список заказов читается, баннер офлайна виден.
- [ ] `select * from cron.job_run_details order by start_time desc limit 5;` — задания pg_cron завершаются `succeeded`.

## 11. Эксплуатация

- **Бэкапы**: Free-тариф хранит бэкапы 1 день (point-in-time нет). Дополнительно: еженедельно `supabase db dump -f backup.sql` локально, файлы Storage — редко меняются, можно выгружать из Dashboard. На Pro ($25/мес) — 7 дней бэкапов и 8 ГБ базы.
- **Лимиты Free и когда переходить на Pro**: 500 МБ БД (~3–5 лет работы СЦ), 1 ГБ Storage (~3 года фото со сжатием), 500K вызовов функций/мес (расход ~5–10K). Сигнал к переходу — письмо Supabase о приближении к лимиту.
- **Пауза проекта**: Free-проект засыпает после 7 дней без запросов — ежеминутный pg_cron не даёт ему уснуть штатно.
- **Обновления системы**: merge в `main` → CI зелёный → бэкенд доезжает Actions'ами, фронт — хостингом. Откат фронта — redeploy предыдущего билда в хостинге; база — только вперёд, корректирующей миграцией.
