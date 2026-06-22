-- =============================================================
-- Доставка уведомлений: схема «очередь + pull по cron».
--
-- Как это работает (ALTER DATABASE НЕ нужен):
--   1) create_order / change_status вызывают public.fn_enqueue_notifications,
--      которая ТОЛЬКО пишет строки в таблицу-очередь public.notification_outbox
--      (никакого net.http_post в триггерах/функциях БД);
--   2) pg_cron раз в минуту дёргает Edge Function notify-dispatch;
--   3) notify-dispatch забирает пачку из очереди (claim_notifications,
--      SKIP LOCKED), отправляет в Telegram/SMTP и закрывает строки
--      (complete_notification) с backoff.
--
-- service_role-ключ НЕ хранится в тексте cron-задания — он лежит в
-- Supabase Vault, а задание читает его в момент запуска. Так ключ не
-- виден в cron.job. Выполнить ОДИН РАЗ в Dashboard → SQL Editor.
-- =============================================================

-- ── Шаг 1. Положить URL проекта и service_role-ключ в Vault ──
-- Подставьте свои значения (Settings → API). Повторный запуск обновляет.
select vault.create_secret(
  'https://ucsiomzdbyjddqslhibi.supabase.co',
  'project_url',
  'URL проекта для cron-вызова Edge Functions'
);
select vault.create_secret(
  '<SERVICE_ROLE_KEY>',         -- Settings → API → service_role (secret!)
  'service_role_key',
  'service_role для авторизации cron → notify-dispatch'
);
-- Если секреты уже существуют, вместо create_secret обновите их:
--   select vault.update_secret(id, new_secret) from vault.secrets where name = 'project_url';
--   select vault.update_secret(id, new_secret) from vault.secrets where name = 'service_role_key';

-- ── Шаг 2. Расписание: cron читает секреты из Vault на каждом тике ──
select cron.schedule(
  'notify-dispatch-every-minute',
  '* * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url')
           || '/functions/v1/notify-dispatch',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' ||
        (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
  $$
);

-- Проверить расписание:   select jobname, schedule, active from cron.job;
-- Журнал запусков:        select status, return_message, start_time
--                           from cron.job_run_details order by start_time desc limit 10;
-- Секреты в Vault:        select name, description from vault.secrets;
-- Снять расписание:       select cron.unschedule('notify-dispatch-every-minute');

-- =============================================================
-- АЛЬТЕРНАТИВА (используется на проде): прямой telegram-отправщик в БД,
-- без Edge Function. Проще, когда нужен только Telegram-канал.
-- Функция public.fn_send_telegram_pending() (миграция
-- 20260622100001_telegram_dispatch_capture) сама ходит в Telegram Bot API
-- через pg_net, читая токен из Vault. Email она НЕ шлёт — для email
-- оставьте путь через notify-dispatch выше.
-- =============================================================

-- ── Шаг 1. Токен бота — в Vault (BotFather → токен). Один раз ──
-- select vault.create_secret('123456:ABC-DEF...', 'telegram_bot_token', 'Telegram Bot API token');
--   (обновить: select vault.update_secret(id, 'NEW_TOKEN')
--              from vault.secrets where name='telegram_bot_token';)

-- ── Шаг 2. Расписание раз в минуту ──
-- select cron.schedule('telegram-dispatch', '* * * * *', $$ select public.fn_send_telegram_pending(); $$);
-- Снять:  select cron.unschedule('telegram-dispatch');

-- ВАЖНО: если pg_cron перестал выполнять задания (cron.job_run_details
-- пуст, attempts не растут) — перезапустите проект (Dashboard → Settings →
-- General → Restart project): это поднимает фоновый воркер pg_cron.
-- Запасной планировщик в обход pg_cron — .github/workflows/notify-cron.yml.
