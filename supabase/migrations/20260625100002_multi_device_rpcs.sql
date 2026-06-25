-- ============================================================
-- Multi-device заказы: RPC создания/добавления/выдачи аппаратов.
-- ============================================================

create or replace function public.create_order(p_client jsonb, p_device jsonb, p_order jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_client_id uuid;
  v_device_id uuid;
  v_initial text;
  v_order orders%rowtype;
  v_od_id uuid;
  v_extra jsonb;
  v_extra_device uuid;
  v_extra_od uuid;
  v_pos int := 1;
begin
  if not public.is_active_staff() then
    raise exception 'Создание заказа доступно сотрудникам сервиса';
  end if;

  v_initial := coalesce(p_order ->> 'initial_status', 'accepted');
  if v_initial not in ('new', 'accepted') then
    raise exception 'Недопустимый начальный статус: %', v_initial;
  end if;

  v_client_id := nullif(p_client ->> 'id', '')::uuid;
  if v_client_id is null then
    insert into clients (name, phone_display, messenger, email, comment)
    values (p_client ->> 'name', p_client ->> 'phone', p_client ->> 'messenger',
            nullif(p_client ->> 'email', ''), p_client ->> 'comment')
    returning id into v_client_id;
  end if;

  insert into devices (category_id, brand_id, model_id, serial_number, completeness,
                       appearance, is_warranty_case, custom_fields)
  values ((p_device ->> 'category_id')::uuid, (p_device ->> 'brand_id')::uuid,
          nullif(p_device ->> 'model_id', '')::uuid, p_device ->> 'serial_number',
          p_device ->> 'completeness', p_device ->> 'appearance',
          coalesce((p_device ->> 'is_warranty_case')::boolean, false),
          coalesce(p_device -> 'custom_fields', '{}'::jsonb))
  returning id into v_device_id;

  insert into orders (client_id, device_id, status, manager_id, master_id, due_date,
                      claimed_defect, prepayment, warranty_days, linked_order_id)
  values (v_client_id, v_device_id, v_initial, auth.uid(),
          nullif(p_order ->> 'master_id', '')::uuid, nullif(p_order ->> 'due_date', '')::date,
          p_order ->> 'claimed_defect', coalesce((p_order ->> 'prepayment')::numeric, 0),
          nullif(p_order ->> 'warranty_days', '')::int, nullif(p_order ->> 'linked_order_id', '')::uuid)
  returning * into v_order;

  insert into order_status_history (order_id, from_status, to_status, changed_by, comment)
  values (v_order.id, null, v_initial, auth.uid(), 'Заказ создан');

  insert into order_devices (order_id, device_id, position, claimed_defect, warranty_days)
  values (v_order.id, v_device_id, 1, p_order ->> 'claimed_defect',
          nullif(p_order ->> 'warranty_days', '')::int)
  returning id into v_od_id;

  if p_order ? 'items' then
    insert into order_items (order_id, order_device_id, item_type, name, price, qty, cost_price)
    select v_order.id, v_od_id, i ->> 'item_type', i ->> 'name',
           (i ->> 'price')::numeric, coalesce((i ->> 'qty')::numeric, 1),
           coalesce((i ->> 'cost_price')::numeric, 0)
    from jsonb_array_elements(p_order -> 'items') i;
  end if;

  if p_order ? 'devices' then
    for v_extra in select * from jsonb_array_elements(p_order -> 'devices') loop
      v_pos := v_pos + 1;
      insert into devices (category_id, brand_id, model_id, serial_number, completeness,
                           appearance, is_warranty_case, custom_fields)
      values ((v_extra ->> 'category_id')::uuid, (v_extra ->> 'brand_id')::uuid,
              nullif(v_extra ->> 'model_id', '')::uuid, v_extra ->> 'serial_number',
              v_extra ->> 'completeness', v_extra ->> 'appearance',
              coalesce((v_extra ->> 'is_warranty_case')::boolean, false),
              coalesce(v_extra -> 'custom_fields', '{}'::jsonb))
      returning id into v_extra_device;

      insert into order_devices (order_id, device_id, position, claimed_defect, warranty_days)
      values (v_order.id, v_extra_device, v_pos, v_extra ->> 'claimed_defect',
              nullif(v_extra ->> 'warranty_days', '')::int)
      returning id into v_extra_od;

      if v_extra ? 'items' then
        insert into order_items (order_id, order_device_id, item_type, name, price, qty, cost_price)
        select v_order.id, v_extra_od, i ->> 'item_type', i ->> 'name',
               (i ->> 'price')::numeric, coalesce((i ->> 'qty')::numeric, 1),
               coalesce((i ->> 'cost_price')::numeric, 0)
        from jsonb_array_elements(v_extra -> 'items') i;
      end if;
    end loop;
  end if;

  if v_initial = 'accepted' then
    perform public.fn_enqueue_notifications(v_order.id, 'order_accepted');
  end if;

  return jsonb_build_object('id', v_order.id, 'display_number', v_order.display_number,
    'qr_token', v_order.qr_token, 'client_id', v_client_id, 'device_id', v_device_id);
end $$;

create or replace function public.add_order_device(p_order_id uuid, p_device jsonb, p_defect text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_status text;
  v_device_id uuid;
  v_od_id uuid;
  v_pos int;
begin
  if not public.is_active_staff() then raise exception 'Доступ запрещён'; end if;
  select status into v_status from orders where id = p_order_id and deleted_at is null;
  if not found then raise exception 'Заказ не найден'; end if;
  if v_status in ('issued', 'scrapped') then raise exception 'Заказ закрыт — добавление аппарата запрещено'; end if;

  insert into devices (category_id, brand_id, model_id, serial_number, completeness,
                       appearance, is_warranty_case, custom_fields)
  values ((p_device ->> 'category_id')::uuid, (p_device ->> 'brand_id')::uuid,
          nullif(p_device ->> 'model_id', '')::uuid, p_device ->> 'serial_number',
          p_device ->> 'completeness', p_device ->> 'appearance',
          coalesce((p_device ->> 'is_warranty_case')::boolean, false),
          coalesce(p_device -> 'custom_fields', '{}'::jsonb))
  returning id into v_device_id;

  select coalesce(max(position), 0) + 1 into v_pos from order_devices where order_id = p_order_id;

  insert into order_devices (order_id, device_id, position, claimed_defect, warranty_days)
  values (p_order_id, v_device_id, v_pos, nullif(btrim(coalesce(p_defect, '')), ''),
          nullif(p_device ->> 'warranty_days', '')::int)
  returning id into v_od_id;

  return v_od_id;
end $$;

create or replace function public.issue_order_device(
  p_order_device_id uuid, p_outcome text default 'issued', p_comment text default null
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_od order_devices%rowtype;
  v_order_id uuid;
  v_prev text;
  v_total int;
  v_done int;
  v_issued int;
  v_finalized boolean := false;
begin
  if not public.is_active_staff() then raise exception 'Доступ запрещён'; end if;
  if p_outcome not in ('issued', 'returned') then raise exception 'Недопустимый исход: %', p_outcome; end if;

  select * into v_od from order_devices where id = p_order_device_id and deleted_at is null for update;
  if not found then raise exception 'Аппарат не найден'; end if;
  v_order_id := v_od.order_id;

  if v_od.outcome is null then
    update order_devices set outcome = p_outcome, issued_at = now(), issued_by = auth.uid()
      where id = p_order_device_id;
  end if;

  select count(*), count(*) filter (where outcome is not null),
         count(*) filter (where outcome = 'issued')
    into v_total, v_done, v_issued
  from order_devices where order_id = v_order_id and deleted_at is null;

  if v_done = v_total then
    select status into v_prev from orders where id = v_order_id;
    if v_prev not in ('issued', 'scrapped') then
      perform set_config('app.status_change', 'on', true);
      update orders set status = case when v_issued > 0 then 'issued' else 'declined' end
        where id = v_order_id;
      perform set_config('app.status_change', '', true);
      insert into order_status_history (order_id, from_status, to_status, changed_by, comment)
      values (v_order_id, v_prev, case when v_issued > 0 then 'issued' else 'declined' end,
              auth.uid(), coalesce(p_comment, 'Все аппараты обработаны'));
      if v_issued > 0 then
        perform public.fn_enqueue_notifications(v_order_id, 'order_issued');
      end if;
      v_finalized := true;
    end if;
  end if;

  return jsonb_build_object('finalized', v_finalized, 'done', v_done, 'total', v_total);
end $$;

revoke execute on function public.add_order_device(uuid, jsonb, text) from public, anon;
grant  execute on function public.add_order_device(uuid, jsonb, text) to authenticated, service_role;
revoke execute on function public.issue_order_device(uuid, text, text) from public, anon;
grant  execute on function public.issue_order_device(uuid, text, text) to authenticated, service_role;
