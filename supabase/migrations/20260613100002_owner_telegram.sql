-- ============================================================
-- Задача 6: уведомления в Telegram — ВЛАДЕЛЬЦУ сервиса, а не клиенту.
--   • org_settings.owner_telegram_chat_id — числовой chat_id владельца
--     (заполняется ботом по /start <OWNER_SETUP_CODE>, см. telegram-webhook);
--   • fn_enqueue_notifications: канал telegram → owner_telegram_chat_id,
--     каналы email/phone_call — по-прежнему клиенту.
-- Идемпотентность сохранена (event_key UNIQUE).
-- ============================================================

alter table public.org_settings
  add column if not exists owner_telegram_chat_id int8;

create or replace function public.fn_enqueue_notifications(p_order_id uuid, p_event text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order orders%rowtype;
  v_client clients%rowtype;
  r record;
  v_recipient text;
  v_owner int8;
begin
  select * into v_order from orders where id = p_order_id;
  if not found then return; end if;
  select * into v_client from clients where id = v_order.client_id;
  select owner_telegram_chat_id into v_owner from org_settings where id = 1;

  for r in select * from notification_rules where event_type = p_event and enabled loop
    v_recipient := case r.channel
      when 'telegram' then v_owner::text          -- уведомляем владельца
      when 'email' then v_client.email
      when 'phone_call' then v_client.phone
    end;

    insert into notification_outbox (event_key, order_id, event_type, channel, recipient, payload, status)
    values (
      v_order.id::text || ':' || p_event || ':' || r.channel,
      v_order.id, p_event, r.channel, v_recipient,
      jsonb_build_object(
        'order_number', v_order.display_number,
        'client_name', v_client.name,
        'status_label', (select label from statuses where code = v_order.status),
        'due_date', v_order.due_date,
        'qr_token', v_order.qr_token,
        'template', r.template
      ),
      case when v_recipient is null or v_recipient = '' then 'skipped' else 'pending' end
    )
    on conflict (event_key) do nothing;  -- идемпотентность
  end loop;
end $$;
