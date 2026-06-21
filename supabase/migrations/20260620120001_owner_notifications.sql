-- ============================================================
-- Цвет статуса «Выдан» → розовый (#EC4899) — совпадает с дашбордом и
-- круговой диаграммой. Плюс привязка уведомлений ВЛАДЕЛЬЦУ: канал
-- (off/telegram/email), адрес и список событий. fn_enqueue_notifications
-- дополнительно кладёт личное уведомление владельцу по выбранному каналу.
-- ============================================================

update public.statuses set color = '#EC4899' where code = 'issued';

alter table public.org_settings
  add column if not exists owner_email text,
  add column if not exists owner_notify_channel text not null default 'off',
  add column if not exists owner_notify_events text[] not null default '{order_accepted,order_issued}';

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'org_settings_owner_notify_channel_chk') then
    alter table public.org_settings
      add constraint org_settings_owner_notify_channel_chk
      check (owner_notify_channel in ('off','telegram','email'));
  end if;
end $$;

create or replace function public.fn_enqueue_notifications(p_order_id uuid, p_event text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order orders%rowtype;
  v_client clients%rowtype;
  v_settings org_settings%rowtype;
  r record;
  v_recipient text;
  v_owner_channel text;
begin
  select * into v_order from orders where id = p_order_id;
  if not found then return; end if;
  select * into v_client from clients where id = v_order.client_id;
  select * into v_settings from org_settings where id = 1;

  -- Клиентские/служебные правила (telegram → владельцу, email/звонок → клиенту)
  for r in select * from notification_rules where event_type = p_event and enabled loop
    v_recipient := case r.channel
      when 'telegram' then v_settings.owner_telegram_chat_id::text
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
    on conflict (event_key) do nothing;
  end loop;

  -- Личное уведомление ВЛАДЕЛЬЦУ по выбранному каналу и событию
  if coalesce(v_settings.owner_notify_channel, 'off') <> 'off'
     and p_event = any(v_settings.owner_notify_events) then
    if v_settings.owner_notify_channel = 'telegram' then
      v_owner_channel := 'telegram';
      v_recipient := v_settings.owner_telegram_chat_id::text;
    else
      v_owner_channel := 'email';
      v_recipient := v_settings.owner_email;
    end if;

    insert into notification_outbox (event_key, order_id, event_type, channel, recipient, payload, status)
    values (
      v_order.id::text || ':' || p_event || ':owner',
      v_order.id, p_event, v_owner_channel, v_recipient,
      jsonb_build_object(
        'order_number', v_order.display_number,
        'client_name', v_client.name,
        'status_label', (select label from statuses where code = v_order.status),
        'due_date', v_order.due_date,
        'qr_token', v_order.qr_token,
        'template', 'Заказ {order_number} ({client_name}): {status_label}'
      ),
      case when v_recipient is null or v_recipient = '' then 'skipped' else 'pending' end
    )
    on conflict (event_key) do nothing;
  end if;
end $$;

revoke execute on function public.fn_enqueue_notifications(uuid, text) from public, anon, authenticated;
