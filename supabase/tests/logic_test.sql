-- =============================================================
-- Тест бизнес-логики: машина статусов, нумерация, доп-поля,
-- нормализация телефонов, soft delete, идемпотентность outbox,
-- справочник и импорт. Запускается scripts/test-db.sh после
-- rls_test.sql на той же базе (счёта строк — только адресные).
-- =============================================================
\set ON_ERROR_STOP on

-- Свои пользователи, чтобы не зависеть от rls_test
insert into auth.users (id) values
  ('b0000000-0000-0000-0000-000000000001'),
  ('b0000000-0000-0000-0000-000000000002')
on conflict (id) do nothing;
insert into public.profiles (id, full_name, role) values
  ('b0000000-0000-0000-0000-000000000001', 'Логик Админ', 'admin'),
  ('b0000000-0000-0000-0000-000000000002', 'Логик Менеджер', 'manager')
on conflict (id) do nothing;

create or replace procedure logic_login(p_uid text, p_role text) language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', p_uid, false);
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_uid, 'app_metadata', json_build_object('role', p_role))::text, false);
end $$;

call logic_login('b0000000-0000-0000-0000-000000000002', 'manager');

-- ===== 1. Нумерация заказов: последовательная, с префиксом =====
do $$
declare
  o1 jsonb; o2 jsonb; v_prefix text;
  v_cat uuid; v_brand uuid;
begin
  select id into v_cat from categories where name_normalized = 'смартфон';
  v_brand := (public.quick_add_model(v_cat, 'ЛогикБренд', 'Модель-1') ->> 'brand_id')::uuid;

  o1 := public.create_order('{"name":"Нум Один","phone":"+79170000001"}',
    jsonb_build_object('category_id', v_cat, 'brand_id', v_brand),
    '{"claimed_defect":"тест нумерации 1"}');
  o2 := public.create_order('{"name":"Нум Два","phone":"+79170000002"}',
    jsonb_build_object('category_id', v_cat, 'brand_id', v_brand),
    '{"claimed_defect":"тест нумерации 2"}');

  select order_prefix into v_prefix from org_settings where id = 1;
  if (select number from orders where id = (o2->>'id')::uuid)
     <> (select number from orders where id = (o1->>'id')::uuid) + 1 then
    raise exception 'FAIL: номера не последовательны';
  end if;
  if o1->>'display_number' not like v_prefix || '%' then
    raise exception 'FAIL: display_number без префикса организации: %', o1->>'display_number';
  end if;
  perform set_config('test.lg_o1', o1->>'id', false);
  raise notice 'OK: нумерация заказов последовательная, с префиксом';
end $$;

-- ===== 2. Машина статусов: запрещённый переход отклонён =====
do $$
declare v_o uuid := current_setting('test.lg_o1')::uuid;
begin
  begin
    perform public.change_status(v_o, 'issued', null);  -- accepted -> issued нет в таблице
    raise exception 'FAIL: менеджеру разрешён переход вне таблицы';
  exception when others then
    if sqlerrm like 'FAIL:%' then raise; end if;
  end;
  if (select status from orders where id = v_o) <> 'accepted' then
    raise exception 'FAIL: статус изменился несмотря на отказ';
  end if;
  raise notice 'OK: переход вне таблицы переходов отклонён';
end $$;

-- ===== 3. Статус не меняется UPDATE-ом мимо change_status() =====
do $$
declare v_o uuid := current_setting('test.lg_o1')::uuid;
begin
  begin
    update orders set status = 'ready' where id = v_o;
    raise exception 'FAIL: статус сменился прямым UPDATE';
  exception when others then
    if sqlerrm like 'FAIL:%' then raise; end if;
  end;
  raise notice 'OK: статус меняется только через change_status()';
end $$;

-- ===== 4. Админ может перейти вне таблицы (ручная коррекция) =====
do $$
declare v_o uuid := current_setting('test.lg_o1')::uuid;
begin
  call logic_login('b0000000-0000-0000-0000-000000000001', 'admin');
  perform public.change_status(v_o, 'in_repair', 'Коррекция админом');
  if (select status from orders where id = v_o) <> 'in_repair' then
    raise exception 'FAIL: админский переход не применился';
  end if;
  raise notice 'OK: админ выполняет переход вне таблицы (коррекция)';
end $$;

-- ===== 5. Идемпотентность outbox: повторное «готов» не дублирует =====
do $$
declare
  v_o uuid := current_setting('test.lg_o1')::uuid;
  n1 int; n2 int;
begin
  perform public.change_status(v_o, 'ready', null);
  select count(*) into n1 from notification_outbox where order_id = v_o and event_type = 'order_ready';
  perform public.change_status(v_o, 'in_repair', 'вернули');
  perform public.change_status(v_o, 'ready', 'снова готов');
  select count(*) into n2 from notification_outbox where order_id = v_o and event_type = 'order_ready';
  if n1 = 0 then raise exception 'FAIL: уведомления order_ready не создались'; end if;
  if n1 <> n2 then raise exception 'FAIL: повторный переход задублировал outbox (% -> %)', n1, n2; end if;
  raise notice 'OK: outbox идемпотентен (event_key)';
end $$;

-- ===== 6. Закрытый заказ: строки работ заблокированы для менеджера =====
do $$
declare v_o uuid := current_setting('test.lg_o1')::uuid;
begin
  perform public.change_status(v_o, 'issued', null);
  call logic_login('b0000000-0000-0000-0000-000000000002', 'manager');
  begin
    insert into order_items (order_id, item_type, name, price) values (v_o, 'work', 'Поздняя работа', 100);
    raise exception 'FAIL: строка добавлена в закрытый заказ';
  exception when others then
    if sqlerrm like 'FAIL:%' then raise; end if;
  end;
  raise notice 'OK: работы в закрытом заказе заблокированы';
end $$;

-- ===== 7. Доп-поля: неизвестный ключ и неверный тип отклонены =====
do $$
declare
  v_cat uuid; v_brand uuid;
begin
  select id into v_cat from categories where name_normalized = 'телевизор';
  v_brand := (public.quick_add_model(v_cat, 'ЛогикБренд', 'ТВ-1') ->> 'brand_id')::uuid;
  begin
    insert into devices (category_id, brand_id, custom_fields)
    values (v_cat, v_brand, '{"unknown_key": 1}');
    raise exception 'FAIL: неизвестный ключ доп-поля принят';
  exception when others then
    if sqlerrm like 'FAIL:%' then raise; end if;
  end;
  begin
    insert into devices (category_id, brand_id, custom_fields)
    values (v_cat, v_brand, '{"diagonal": "не число"}');
    raise exception 'FAIL: неверный тип доп-поля принят';
  exception when others then
    if sqlerrm like 'FAIL:%' then raise; end if;
  end;
  insert into devices (category_id, brand_id, custom_fields)
  values (v_cat, v_brand, '{"diagonal": 55, "matrix_type": "OLED"}');
  raise notice 'OK: валидация доп-полей (ключ, тип, корректное значение)';
end $$;

-- ===== 8. Шаблон поля: key и тип неизменяемы =====
do $$
declare v_tpl uuid;
begin
  select id into v_tpl from field_templates where key = 'diagonal' limit 1;
  begin
    update field_templates set key = 'diagonal2' where id = v_tpl;
    raise exception 'FAIL: key шаблона изменён';
  exception when others then
    if sqlerrm like 'FAIL:%' then raise; end if;
  end;
  update field_templates set label = 'Диагональ экрана, дюймы' where id = v_tpl;
  update field_templates set label = 'Диагональ, дюймы' where id = v_tpl;
  raise notice 'OK: key шаблона неизменяем, label — можно';
end $$;

-- ===== 9. Телефон клиента нормализуется =====
do $$
declare v_id uuid;
begin
  insert into clients (name, phone_display) values ('Тел Тест', '8 (917) 000-11-22')
  returning id into v_id;
  if (select phone from clients where id = v_id) <> '+79170001122' then
    raise exception 'FAIL: телефон не нормализован: %', (select phone from clients where id = v_id);
  end if;
  raise notice 'OK: телефон нормализован в +7XXXXXXXXXX';
end $$;

-- ===== 10. Физическое удаление запрещено, история append-only =====
do $$
declare v_o uuid := current_setting('test.lg_o1')::uuid;
begin
  begin
    delete from orders where id = v_o;
    raise exception 'FAIL: заказ удалён физически';
  exception when others then
    if sqlerrm like 'FAIL:%' then raise; end if;
  end;
  begin
    update order_status_history set comment = 'подмена' where order_id = v_o;
    raise exception 'FAIL: история переписана';
  exception when others then
    if sqlerrm like 'FAIL:%' then raise; end if;
  end;
  raise notice 'OK: физический DELETE запрещён, история append-only';
end $$;

-- ===== 11. quick_add_model идемпотентен =====
do $$
declare a jsonb; b jsonb; v_cat uuid;
begin
  select id into v_cat from categories where name_normalized = 'смартфон';
  a := public.quick_add_model(v_cat, 'ЛогикБренд', 'Дубль-Модель');
  b := public.quick_add_model(v_cat, 'логикбренд', 'дубль-модель');  -- другой регистр
  if a->>'model_id' <> b->>'model_id' then
    raise exception 'FAIL: одинаковая модель создана дважды';
  end if;
  raise notice 'OK: quick_add_model идемпотентен (без учёта регистра)';
end $$;

-- ===== 12. Импорт: вставка, пропуск дублей, ошибки строк =====
do $$
declare res jsonb;
begin
  call logic_login('b0000000-0000-0000-0000-000000000001', 'admin');
  res := public.import_catalog_batch('[
    {"category":"Смартфон","brand":"ИмпортБренд","model":"Модель-А"},
    {"category":"Смартфон","brand":"ИмпортБренд","model":"Модель-Б"},
    {"category":"Смартфон","brand":"ИмпортБренд","model":"Модель-А"},
    {"category":"","brand":"X","model":"Y"}
  ]');
  if (res->>'inserted')::int <> 2 then raise exception 'FAIL: импорт inserted=%', res->>'inserted'; end if;
  if (res->>'skipped')::int <> 1 then raise exception 'FAIL: импорт skipped=%', res->>'skipped'; end if;
  if jsonb_array_length(res->'errors') <> 1 then raise exception 'FAIL: импорт errors=%', res->'errors'; end if;
  res := public.import_catalog_batch('[{"category":"Смартфон","brand":"ИмпортБренд","model":"Модель-А"}]');
  if (res->>'inserted')::int <> 0 or (res->>'skipped')::int <> 1 then
    raise exception 'FAIL: повторный импорт не пропустил дубль';
  end if;
  raise notice 'OK: импорт каталога (вставка / дубли / ошибки построчно)';
end $$;

-- ===== 13. Глобальный поиск: телефон и серийник =====
do $$
declare
  v_cat uuid; v_brand uuid; o jsonb; n int;
begin
  call logic_login('b0000000-0000-0000-0000-000000000002', 'manager');
  select id into v_cat from categories where name_normalized = 'смартфон';
  v_brand := (public.quick_add_model(v_cat, 'ЛогикБренд', 'Поиск-1') ->> 'brand_id')::uuid;
  o := public.create_order('{"name":"Поиск Клиент","phone":"+79175556677"}',
    jsonb_build_object('category_id', v_cat, 'brand_id', v_brand, 'serial_number', 'SRCH-99-XYZ'),
    '{"claimed_defect":"тест поиска"}');

  select count(*) into n from public.global_search('5556677', 10)
  where order_id = (o->>'id')::uuid;
  if n = 0 then raise exception 'FAIL: поиск по телефону не нашёл заказ'; end if;

  select count(*) into n from public.global_search('SRCH-99', 10)
  where order_id = (o->>'id')::uuid;
  if n = 0 then raise exception 'FAIL: поиск по серийнику не нашёл заказ'; end if;
  raise notice 'OK: глобальный поиск по телефону и серийному номеру';
end $$;

drop procedure logic_login(text, text);
\echo LOGIC_ALL_OK
