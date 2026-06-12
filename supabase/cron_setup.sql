-- =============================================================
-- Расписание доставки уведомлений (выполнить ОДИН РАЗ в облаке:
-- Supabase Dashboard → SQL Editor, подставив свои значения).
-- Это не миграция: команда содержит секрет проекта, ей не место
-- в репозитории и истории миграций.
--
-- Подставить:
--   <PROJECT_REF>       — Settings → General → Reference ID
--   <SERVICE_ROLE_KEY>  — Settings → API → service_role (secret!)
-- =============================================================

select cron.schedule(
  'notify-dispatch-every-minute',
  '* * * * *',
  $$
  select net.http_post(
    url := 'https://<PROJECT_REF>.supabase.co/functions/v1/notify-dispatch',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer <SERVICE_ROLE_KEY>'
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
  $$
);

-- Проверить: select * from cron.job;
-- Журнал:   select * from cron.job_run_details order by start_time desc limit 10;
-- Удалить:  select cron.unschedule('notify-dispatch-every-minute');
