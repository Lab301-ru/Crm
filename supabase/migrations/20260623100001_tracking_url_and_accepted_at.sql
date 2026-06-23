-- ============================================================
-- Исправления:
--  1) Telegram-уведомления: ссылка отслеживания ведёт на фронтенд
--     (/status/<token>), а не на Edge Function public-status (которая
--     возвращала application/json и пугала клиентов файлом public-status.json).
--     URL фронтенда — из Vault.secret 'app_url'; если не задан, остаётся
--     прежний путь к Edge Function как безопасный fallback.
--
--  2) change_status: при переходе в 'accepted' проставляем accepted_at,
--     если оно ещё null. Иначе заказы, созданные как «Предзапись» (статус
--     'new') и переведённые в 'accepted' через смену статуса, не попадали
--     в счётчик «принято сегодня» на дашборде (у них accepted_at оставался
--     null — он ставился только триггером при INSERT).
-- ============================================================

create or replace function public.fn_send_telegram_pending(p_limit integer default 20)
returns integer language plpgsql security definer set search_path to 'public' as $function$
declare
  v_token text;
  v_app_url text;
  r record;
  v_text text;
  v_track text;
  v_sent int := 0;
begin
  select decrypted_secret into v_token from vault.decrypted_secrets where name='telegram_bot_token' limit 1;
  if v_token is null then raise exception 'telegram_bot_token не задан в Vault'; end if;

  select decrypted_secret into v_app_url from vault.decrypted_secrets where name='app_url' limit 1;
  v_app_url := rtrim(coalesce(v_app_url, 'https://ucsiomzdbyjddqslhibi.supabase.co/functions/v1/public-status'), '/');

  for r in
    select * from notification_outbox
    where channel='telegram' and status='pending'
      and recipient is not null and recipient <> ''
      and (next_retry_at is null or next_retry_at <= now())
    order by created_at limit p_limit for update skip locked
  loop
    v_track := v_app_url || '/status/' || coalesce(r.payload->>'qr_token','');
    v_text := coalesce(r.payload->>'template', r.payload->>'status_label', 'Уведомление');
    v_text := replace(v_text, '{order_number}', coalesce(r.payload->>'order_number',''));
    v_text := replace(v_text, '{tracking_url}', v_track);
    v_text := replace(v_text, '{client_name}', coalesce(r.payload->>'client_name',''));
    v_text := replace(v_text, '{status_label}', coalesce(r.payload->>'status_label',''));

    perform net.http_post(
      url := 'https://api.telegram.org/bot' || v_token || '/sendMessage',
      headers := jsonb_build_object('Content-Type','application/json'),
      body := jsonb_build_object('chat_id', r.recipient, 'text', v_text, 'disable_web_page_preview', false)
    );

    update notification_outbox
      set status='sent', sent_at=now(), attempts=attempts+1, updated_at=now()
      where id = r.id;
    v_sent := v_sent + 1;
  end loop;
  return v_sent;
end $function$;

revoke execute on function public.fn_send_telegram_pending(integer) from public, anon, authenticated;
grant  execute on function public.fn_send_telegram_pending(integer) to service_role;

create or replace function public.change_status(p_order_id uuid, p_to text, p_comment text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_order orders%rowtype;
  v_event text;
begin
  if not public.is_active_staff() then raise exception 'Доступ запрещён'; end if;
  select * into v_order from orders where id = p_order_id and deleted_at is null for update;
  if not found then raise exception 'Заказ не найден'; end if;

  if public.app_role() = 'master' and v_order.master_id is distinct from auth.uid() then
    raise exception 'Мастер меняет статус только своих заказов';
  end if;
  if v_order.status = p_to then return; end if;

  if not exists (
    select 1 from status_transitions where from_code = v_order.status and to_code = p_to
  ) and public.app_role() <> 'admin' then
    raise exception 'Переход "%" → "%" запрещён', v_order.status, p_to;
  end if;

  perform set_config('app.status_change', 'on', true);
  if p_to = 'accepted' and v_order.accepted_at is null then
    update orders set status = p_to, accepted_at = now() where id = p_order_id;
  else
    update orders set status = p_to where id = p_order_id;
  end if;
  perform set_config('app.status_change', '', true);

  insert into order_status_history (order_id, from_status, to_status, changed_by, comment)
  values (p_order_id, v_order.status, p_to, auth.uid(), p_comment);

  v_event := case p_to
    when 'accepted' then 'order_accepted'
    when 'awaiting_approval' then 'cost_approval'
    when 'awaiting_parts' then 'awaiting_parts'
    when 'ready' then 'order_ready'
    when 'issued' then 'order_issued'
    else null
  end;
  if v_event is not null then
    perform public.fn_enqueue_notifications(p_order_id, v_event);
  end if;
end $$;

revoke execute on function public.change_status(uuid, text, text) from public, anon;
grant  execute on function public.change_status(uuid, text, text) to authenticated, service_role;
