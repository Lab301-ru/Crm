-- =============================================================
-- ДЕМО-ДАННЫЕ ДЛЯ ЛОКАЛЬНОЙ РАЗРАБОТКИ. В продакшене не применять!
-- Запускается scripts/dev.sh после `supabase db reset`
-- (или вручную: psql <DB_URL> -f scripts/demo-data.sql).
-- Рассчитан на однократный запуск поверх свежей базы.
--
-- Заказы и справочник создаются через боевые RPC (create_order,
-- quick_add_model, change_status) — демо проходит те же триггеры,
-- валидации и уведомления, что и реальная работа.
-- =============================================================
\set ON_ERROR_STOP on

-- ------------------------------------------------------------
-- Сотрудники: admin@demo.local / manager@demo.local /
-- master@demo.local, пароль у всех: demo1234 (только локально!)
-- На тестовом шиме (без GoTrue) создаются только id.
-- ------------------------------------------------------------
do $$
declare
  v_gotrue boolean;
  v_ids uuid[] := array[
    'd0000000-0000-0000-0000-000000000001',
    'd0000000-0000-0000-0000-000000000002',
    'd0000000-0000-0000-0000-000000000003'
  ];
  v_emails text[] := array['admin@demo.local', 'manager@demo.local', 'master@demo.local'];
  v_roles  text[] := array['admin', 'manager', 'master'];
  i int;
begin
  select exists (
    select 1 from information_schema.columns
    where table_schema = 'auth' and table_name = 'users' and column_name = 'encrypted_password'
  ) into v_gotrue;

  for i in 1..3 loop
    if v_gotrue then
      insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
                              email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
                              created_at, updated_at)
      values ('00000000-0000-0000-0000-000000000000', v_ids[i], 'authenticated', 'authenticated',
              v_emails[i], crypt('demo1234', gen_salt('bf')), now(),
              jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email'), 'role', v_roles[i]),
              '{}', now(), now())
      on conflict (id) do nothing;

      insert into auth.identities (id, user_id, provider_id, identity_data, provider,
                                   last_sign_in_at, created_at, updated_at)
      values (gen_random_uuid(), v_ids[i], v_ids[i]::text,
              jsonb_build_object('sub', v_ids[i]::text, 'email', v_emails[i], 'email_verified', true),
              'email', now(), now(), now())
      on conflict (provider_id, provider) do nothing;
    else
      insert into auth.users (id) values (v_ids[i]) on conflict (id) do nothing;
    end if;
  end loop;
end $$;

insert into public.profiles (id, full_name, phone, role) values
  ('d0000000-0000-0000-0000-000000000001', 'Александр Демо (админ)',   '+79990000001', 'admin'),
  ('d0000000-0000-0000-0000-000000000002', 'Мария Демо (менеджер)',    '+79990000002', 'manager'),
  ('d0000000-0000-0000-0000-000000000003', 'Михаил Демо (мастер)',     '+79990000003', 'master')
on conflict (id) do nothing;

-- «Вход» под пользователем: те же GUC, что выставляет GoTrue
create function pg_temp.login(p_uid text, p_role text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', p_uid, false);
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_uid, 'app_metadata', json_build_object('role', p_role))::text, false);
end $$;

-- ------------------------------------------------------------
-- Справочник и заказы — одним сценарием «как в жизни»
-- ------------------------------------------------------------
do $$
declare
  v_admin   constant uuid := 'd0000000-0000-0000-0000-000000000001';
  v_manager constant uuid := 'd0000000-0000-0000-0000-000000000002';
  v_master  constant uuid := 'd0000000-0000-0000-0000-000000000003';
  v_phone  uuid; v_tv uuid; v_coffee uuid; v_vacuum uuid;
  m jsonb; o jsonb;
  v_order uuid; v_client uuid;
begin
  perform pg_temp.login(v_admin::text, 'admin');

  select id into v_phone  from categories where name_normalized = 'смартфон';
  select id into v_tv     from categories where name_normalized = 'телевизор';
  select id into v_coffee from categories where name_normalized = 'кофемашина';
  select id into v_vacuum from categories where name_normalized = 'робот-пылесос';

  -- Модели «на лету», как из формы приёмки
  perform public.quick_add_model(v_phone,  'Apple',   'iPhone 12');
  perform public.quick_add_model(v_phone,  'Samsung', 'Galaxy S23');
  perform public.quick_add_model(v_phone,  'Xiaomi',  'Redmi Note 12');
  perform public.quick_add_model(v_tv,     'LG',      'OLED55C3');
  perform public.quick_add_model(v_tv,     'Samsung', 'QE50Q80');
  perform public.quick_add_model(v_coffee, 'DeLonghi','Magnifica S');
  perform public.quick_add_model(v_coffee, 'Philips', 'LatteGo 3200');
  perform public.quick_add_model(v_vacuum, 'Xiaomi',  'Mi Robot Vacuum');
  perform public.quick_add_model(v_vacuum, 'iRobot',  'Roomba 698');
  m := public.quick_add_model(v_phone, 'Apple', 'iPhone 14 Pro');

  -- ЗАКАЗ 1: iPhone 14 Pro, разбит экран — полный путь до «Готов»
  o := public.create_order(
    '{"name":"Иван Петров","phone":"+79161234501","email":"petrov@example.com"}',
    jsonb_build_object('category_id', v_phone, 'brand_id', m->>'brand_id',
                       'model_id', m->>'model_id', 'serial_number', 'F2LXK1ABMD6T',
                       'appearance', 'разбит экран, царапины на рамке',
                       'completeness', 'устройство, чехол',
                       'custom_fields', '{"imei":"353912100123456","apple_id_status":"выключен"}'::jsonb),
    jsonb_build_object('claimed_defect', 'Разбит экран, сенсор не работает',
                       'master_id', v_master, 'prepayment', 2000,
                       'due_date', (current_date + 3)::text, 'warranty_days', 30,
                       'items', '[{"item_type":"work","name":"Замена дисплейного модуля","price":4500},
                                  {"item_type":"part","name":"Дисплейный модуль iPhone 14 Pro (ориг.)","price":15500}]'::jsonb));
  v_order := (o->>'id')::uuid;
  v_client := (o->>'client_id')::uuid;
  perform pg_temp.login(v_master::text, 'master');
  perform public.change_status(v_order, 'diagnostics', 'Подтверждена замена модуля');
  perform pg_temp.login(v_manager::text, 'manager');
  perform public.change_status(v_order, 'awaiting_approval', 'Согласована стоимость 20 000 ₽');
  perform public.change_status(v_order, 'in_repair', null);
  perform pg_temp.login(v_master::text, 'master');
  perform public.change_status(v_order, 'ready', 'Заменён модуль, тесты пройдены');

  -- ЗАКАЗ 2: тот же клиент, второй аппарат — история клиента в карточке
  perform pg_temp.login(v_manager::text, 'manager');
  select (public.quick_add_model(v_phone, 'Apple', 'iPhone 12')->>'model_id')::uuid into strict v_order;
  o := public.create_order(
    jsonb_build_object('id', v_client),
    jsonb_build_object('category_id', v_phone,
                       'brand_id', (select brand_id from models where id = v_order),
                       'model_id', v_order,
                       'custom_fields', '{"imei":"353912100654321"}'::jsonb),
    '{"claimed_defect":"Не работает Face ID после падения"}'::jsonb);
  perform public.change_status((o->>'id')::uuid, 'diagnostics', null);
  perform public.change_status((o->>'id')::uuid, 'declined', 'Ремонт нецелесообразен: модуль Face ID повреждён необратимо');

  -- ЗАКАЗ 3: Samsung S23, не заряжается — в ремонте у мастера
  m := public.quick_add_model(v_phone, 'Samsung', 'Galaxy S23');
  o := public.create_order(
    '{"name":"Ольга Сидорова","phone":"+79262234502"}',
    jsonb_build_object('category_id', v_phone, 'brand_id', m->>'brand_id', 'model_id', m->>'model_id',
                       'custom_fields', '{"imei":"358240051111111"}'::jsonb),
    jsonb_build_object('claimed_defect', 'Не заряжается, греется разъём',
                       'master_id', v_master, 'due_date', (current_date + 2)::text,
                       'items', '[{"item_type":"work","name":"Замена разъёма зарядки","price":2500},
                                  {"item_type":"part","name":"Шлейф с разъёмом USB-C","price":1800}]'::jsonb));
  perform public.change_status((o->>'id')::uuid, 'diagnostics', null);
  perform public.change_status((o->>'id')::uuid, 'in_repair', 'Разъём выгорел, меняем шлейф');

  -- ЗАКАЗ 4: кофемашина — выдана и оплачена (выручка на дашборде)
  m := public.quick_add_model(v_coffee, 'DeLonghi', 'Magnifica S');
  o := public.create_order(
    '{"name":"Анна Васильева","phone":"+79031234503","email":"vasileva@example.com"}',
    jsonb_build_object('category_id', v_coffee, 'brand_id', m->>'brand_id', 'model_id', m->>'model_id',
                       'custom_fields', '{"machine_type":"автоматическая","brew_counter":4820}'::jsonb),
    jsonb_build_object('claimed_defect', 'Протекает, кофе не горячий',
                       'master_id', v_master, 'warranty_days', 90,
                       'items', '[{"item_type":"work","name":"Чистка и декальцинация","price":1500},
                                  {"item_type":"work","name":"Замена уплотнителей заварного узла","price":1200},
                                  {"item_type":"part","name":"Ремкомплект уплотнителей","price":800}]'::jsonb));
  v_order := (o->>'id')::uuid;
  perform public.change_status(v_order, 'diagnostics', null);
  perform public.change_status(v_order, 'in_repair', null);
  perform public.change_status(v_order, 'ready', 'Готова, тестовая варка в норме');
  update orders set payment_status = 'paid', payment_method = 'card' where id = v_order;
  perform public.change_status(v_order, 'issued', 'Выдана клиенту');

  -- ЗАКАЗ 5: телевизор — только принят (свежая приёмка)
  m := public.quick_add_model(v_tv, 'LG', 'OLED55C3');
  perform public.create_order(
    '{"name":"Николай Кузнецов","phone":"+79114234504"}',
    jsonb_build_object('category_id', v_tv, 'brand_id', m->>'brand_id', 'model_id', m->>'model_id',
                       'custom_fields', '{"diagonal":55,"matrix_type":"OLED"}'::jsonb),
    jsonb_build_object('claimed_defect', 'Нет изображения, звук есть',
                       'due_date', (current_date + 5)::text));

  -- ЗАКАЗ 6: телевизор — ожидание запчастей
  m := public.quick_add_model(v_tv, 'Samsung', 'QE50Q80');
  o := public.create_order(
    '{"name":"Елена Морозова","phone":"+79215234505"}',
    jsonb_build_object('category_id', v_tv, 'brand_id', m->>'brand_id', 'model_id', m->>'model_id',
                       'custom_fields', '{"diagonal":50,"matrix_type":"QLED"}'::jsonb),
    jsonb_build_object('claimed_defect', 'Вертикальные полосы на экране', 'master_id', v_master));
  perform public.change_status((o->>'id')::uuid, 'diagnostics', null);
  perform public.change_status((o->>'id')::uuid, 'awaiting_approval', 'Нужна замена матрицы, ждём решения клиента');
  perform public.change_status((o->>'id')::uuid, 'awaiting_parts', 'Клиент согласен, матрица заказана');

  -- ЗАКАЗ 7: робот-пылесос — диагностика
  m := public.quick_add_model(v_vacuum, 'Xiaomi', 'Mi Robot Vacuum');
  o := public.create_order(
    '{"name":"Пётр Смирнов","phone":"+79503234506"}',
    jsonb_build_object('category_id', v_vacuum, 'brand_id', m->>'brand_id', 'model_id', m->>'model_id',
                       'custom_fields', '{"battery_state":"требует замены"}'::jsonb),
    jsonb_build_object('claimed_defect', 'Не включается, не заряжается', 'master_id', v_master));
  perform public.change_status((o->>'id')::uuid, 'diagnostics', null);

  -- ЗАКАЗ 8: просроченный (красный бейдж на дашборде и в списке)
  m := public.quick_add_model(v_phone, 'Xiaomi', 'Redmi Note 12');
  o := public.create_order(
    '{"name":"Дмитрий Волков","phone":"+79617234507"}',
    jsonb_build_object('category_id', v_phone, 'brand_id', m->>'brand_id', 'model_id', m->>'model_id'),
    jsonb_build_object('claimed_defect', 'Быстро садится батарея, требуется замена',
                       'master_id', v_master, 'due_date', (current_date - 1)::text,
                       'items', '[{"item_type":"work","name":"Замена аккумулятора","price":1900},
                                  {"item_type":"part","name":"Аккумулятор BN5G","price":1400}]'::jsonb));
  perform public.change_status((o->>'id')::uuid, 'diagnostics', null);
  perform public.change_status((o->>'id')::uuid, 'in_repair', null);
end $$;

\echo ''
\echo 'Демо-данные загружены: 8 заказов, 7 клиентов, справочник моделей.'
\echo 'Вход: admin@demo.local / manager@demo.local / master@demo.local — пароль demo1234'
