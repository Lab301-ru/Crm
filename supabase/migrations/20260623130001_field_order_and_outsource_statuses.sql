-- ============================================================
-- Новые статусы: «Выездной заказ» (для выездных мастеров) и
-- «Аутсорс» (ремонт сторонним мастером/сервисом) + исполнитель аутсорса.
-- ============================================================

alter table public.orders
  add column if not exists outsource_executor text;

-- Сами статусы «field_order»/«outsource» и их переходы заведены в seed.sql
-- рядом с базовыми статусами (FK переходов ссылается на коды из seed,
-- а seed применяется после миграций).

-- ------------------------------------------------------------
-- change_status: добавлен необязательный исполнитель аутсорса.
-- При переходе в 'outsource' сохраняем название организации/мастера.
-- ------------------------------------------------------------
drop function if exists public.change_status(uuid, text, text);

create or replace function public.change_status(
  p_order_id uuid,
  p_to text,
  p_comment text default null,
  p_executor text default null
)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_order orders%rowtype;
  v_event text;
begin
  if not public.is_active_staff() then raise exception 'Доступ запрещён'; end if;
  select * into v_order from orders where id = p_order_id and deleted_at is null for update;
  if not found then raise exception 'Заказ не найден'; end if;

  if v_order.status = p_to then return; end if;

  if not exists (
    select 1 from status_transitions where from_code = v_order.status and to_code = p_to
  ) and public.app_role() <> 'admin' then
    raise exception 'Переход "%" → "%" запрещён', v_order.status, p_to;
  end if;

  perform set_config('app.status_change', 'on', true);
  if p_to = 'accepted' and v_order.accepted_at is null then
    update orders set status = p_to, accepted_at = now() where id = p_order_id;
  elsif p_to = 'outsource' then
    update orders
      set status = p_to,
          outsource_executor = coalesce(nullif(btrim(coalesce(p_executor, '')), ''), outsource_executor)
      where id = p_order_id;
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

revoke execute on function public.change_status(uuid, text, text, text) from public, anon;
grant  execute on function public.change_status(uuid, text, text, text) to authenticated, service_role;
