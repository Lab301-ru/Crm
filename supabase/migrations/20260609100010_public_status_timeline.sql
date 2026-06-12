-- =============================================================
-- ЭТАП 12. Публичная страница: таймлайн статусов и код статуса
-- =============================================================
-- Белый список расширяется строго в рамках обещания квитанции
-- («клиент видит только номер, статус, даты и комментарий сервиса»):
--  - status_code — чтобы страница подсветила «готов к выдаче»;
--  - history — метки/цвета/даты пройденных статусов, БЕЗ имён
--    сотрудников и БЕЗ внутренних комментариев к переходам.
create or replace function public.public_order_status(p_token text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'order_number', o.display_number,
    'status', s.label,
    'status_code', s.code,
    'status_color', s.color,
    'is_terminal', s.is_terminal,
    'accepted_at', o.accepted_at,
    'due_date', o.due_date,
    'service_comment', o.public_comment,
    'history', coalesce((
      select jsonb_agg(jsonb_build_object(
        'status', hs.label, 'color', hs.color, 'at', h.created_at
      ) order by h.created_at)
      from order_status_history h
      join statuses hs on hs.code = h.to_status
      where h.order_id = o.id
    ), '[]'::jsonb),
    'org', jsonb_build_object(
      'name', g.name, 'phone', g.phone, 'address', g.address,
      'working_hours', g.working_hours, 'contacts', g.public_contacts
    )
  )
  from orders o
  join statuses s on s.code = o.status
  cross join org_settings g
  where o.qr_token = p_token and o.deleted_at is null and g.id = 1;
$$;

-- Права не наследуются при create or replace с новой сигнатурой? Сигнатура
-- та же — гранты сохраняются, но фиксируем явно для переносимости.
revoke execute on function public.public_order_status(text) from public, anon, authenticated;
grant execute on function public.public_order_status(text) to service_role;
