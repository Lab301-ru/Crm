-- ============================================================
-- Telegram-доставка: фиксация фактического рабочего механизма +
-- устранение дублей уведомлений владельцу.
--
--  • fn_send_telegram_pending() — отправщик, который дёргает pg_cron
--    (задача telegram-dispatch). Берёт токен бота из Supabase Vault
--    (секрет 'telegram_bot_token'), шлёт pending-строки канала telegram
--    в Telegram Bot API и помечает их sent. Ранее жил только в БД
--    (миграция telegram_direct_dispatcher), здесь фиксируется в репозитории.
--
--  • Дедупликация: на каждое событие телеграм-уведомление владельцу
--    формировал И «личный блок владельца» в fn_enqueue_notifications,
--    И правило канала telegram в notification_rules — отсюда 2 одинаковых
--    сообщения. Оставляем единственным источником «личный блок владельца»
--    (он настраивается в Настройки → Уведомления: owner_notify_channel /
--    owner_notify_events), а telegram-правила в notification_rules гасим.
--
-- Требование окружения: секрет Vault 'telegram_bot_token' и cron-задача
-- 'telegram-dispatch' (см. supabase/cron_setup.sql).
-- ============================================================

create or replace function public.fn_send_telegram_pending(p_limit integer default 20)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_token text;
  r record;
  v_text text;
  v_track text;
  v_sent int := 0;
begin
  select decrypted_secret into v_token from vault.decrypted_secrets where name = 'telegram_bot_token' limit 1;
  if v_token is null then
    raise exception 'telegram_bot_token не задан в Vault';
  end if;

  for r in
    select * from notification_outbox
    where channel = 'telegram' and status = 'pending'
      and recipient is not null and recipient <> ''
      and (next_retry_at is null or next_retry_at <= now())
    order by created_at
    limit p_limit
    for update skip locked
  loop
    v_track := 'https://ucsiomzdbyjddqslhibi.supabase.co/functions/v1/public-status?token=' || coalesce(r.payload->>'qr_token','');
    v_text := coalesce(r.payload->>'template', r.payload->>'status_label', 'Уведомление');
    v_text := replace(v_text, '{order_number}', coalesce(r.payload->>'order_number',''));
    v_text := replace(v_text, '{tracking_url}', v_track);
    v_text := replace(v_text, '{client_name}', coalesce(r.payload->>'client_name',''));
    v_text := replace(v_text, '{status_label}', coalesce(r.payload->>'status_label',''));

    perform net.http_post(
      url := 'https://api.telegram.org/bot' || v_token || '/sendMessage',
      headers := jsonb_build_object('Content-Type','application/json'),
      body := jsonb_build_object('chat_id', r.recipient, 'text', v_text)
    );

    update notification_outbox
      set status = 'sent', sent_at = now(), attempts = attempts + 1, updated_at = now()
      where id = r.id;
    v_sent := v_sent + 1;
  end loop;

  return v_sent;
end $function$;

revoke execute on function public.fn_send_telegram_pending(integer) from public, anon, authenticated;
grant execute on function public.fn_send_telegram_pending(integer) to service_role;

-- Дедупликация: гасим telegram-правила (источник — «личный блок владельца»)
update public.notification_rules set enabled = false where channel = 'telegram';
