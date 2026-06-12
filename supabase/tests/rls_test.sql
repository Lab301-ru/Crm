\set ON_ERROR_STOP on
-- ===== Сотрудники: admin / manager / master1 / master2 =====
insert into auth.users (id) values
  ('a0000000-0000-0000-0000-000000000001'),
  ('a0000000-0000-0000-0000-000000000002'),
  ('a0000000-0000-0000-0000-000000000003'),
  ('a0000000-0000-0000-0000-000000000004');
insert into public.profiles (id, full_name, role) values
  ('a0000000-0000-0000-0000-000000000001', 'Админ', 'admin'),
  ('a0000000-0000-0000-0000-000000000002', 'Менеджер', 'manager'),
  ('a0000000-0000-0000-0000-000000000003', 'Мастер Один', 'master'),
  ('a0000000-0000-0000-0000-000000000004', 'Мастер Два', 'master');

-- Хелпер: вход под ролью
create or replace procedure test_login(p_uid text, p_role text) language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', p_uid, false);
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_uid, 'app_metadata', json_build_object('role', p_role))::text, false);
end $$;

-- ===== Данные: менеджер создаёт 3 заказа =====
call test_login('a0000000-0000-0000-0000-000000000002', 'manager');
set role authenticated;

-- Менеджер добавляет модель на лету (как в форме приёмки)
select public.quick_add_model(
  (select id from categories where name_normalized='смартфон'), 'Apple', 'iPhone 14') as qm \gset

select public.create_order(
  '{"name":"Клиент А","phone":"89990000001"}',
  format('{"category_id":"%s","brand_id":"%s"}',
    (select id from categories where name_normalized='смартфон'),
    (select id from brands limit 1))::jsonb,
  '{"claimed_defect":"Тест А","master_id":"a0000000-0000-0000-0000-000000000003"}') \gset o1_
select public.create_order(
  '{"name":"Клиент Б","phone":"89990000002"}',
  format('{"category_id":"%s","brand_id":"%s"}',
    (select id from categories where name_normalized='смартфон'),
    (select id from brands limit 1))::jsonb,
  '{"claimed_defect":"Тест Б","master_id":"a0000000-0000-0000-0000-000000000004"}') \gset o2_
select public.create_order(
  '{"name":"Клиент В","phone":"89990000003"}',
  format('{"category_id":"%s","brand_id":"%s"}',
    (select id from categories where name_normalized='смартфон'),
    (select id from brands limit 1))::jsonb,
  '{"claimed_defect":"Тест В"}') \gset o3_

-- id чужого для мастера заказа — в GUC (psql-переменные не работают в DO)
select set_config('test.o2_id', (:'o2_create_order'::jsonb) ->> 'id', false);

-- Менеджер видит все 3 заказа
do $$ begin
  if (select count(*) from orders) <> 3 then raise exception 'FAIL: менеджер видит не все заказы'; end if;
  raise notice 'OK: менеджер видит все заказы (3)';
end $$;

-- Менеджер НЕ читает аудит
do $$ begin
  if (select count(*) from audit_log) <> 0 then raise exception 'FAIL: менеджеру виден аудит'; end if;
  raise notice 'OK: аудит менеджеру не виден';
end $$;

-- Менеджер не может править настройки организации (0 строк под RLS)
do $$
declare n int;
begin
  update org_settings set name = 'Взлом' where id = 1;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: менеджер изменил org_settings'; end if;
  raise notice 'OK: org_settings менеджеру недоступны на запись';
end $$;

-- Менеджер не может добавить статус (RLS with check)
do $$ begin
  begin
    insert into statuses (code, label) values ('hack', 'Взлом');
    raise exception 'FAIL: менеджер добавил статус';
  exception when insufficient_privilege then
    raise notice 'OK: менеджеру запрещено менять статусы';
  end;
end $$;

-- ===== Мастер 1 =====
reset role;
call test_login('a0000000-0000-0000-0000-000000000003', 'master');
set role authenticated;

-- Видит только свой заказ
do $$ begin
  if (select count(*) from orders) <> 1 then raise exception 'FAIL: мастер видит чужие заказы'; end if;
  if (select count(*) from order_list) <> 1 then raise exception 'FAIL: order_list отдаёт чужие'; end if;
  raise notice 'OK: мастер видит только свой заказ';
end $$;

-- Видит только клиента своего заказа
do $$ begin
  if (select count(*) from clients) <> 1 then raise exception 'FAIL: мастер видит чужих клиентов'; end if;
  raise notice 'OK: мастер видит только своего клиента';
end $$;

-- Может: диагностика на своём заказе
do $$
declare n int;
begin
  update orders set diagnostic_result = 'Диагностика ок';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL: мастер не смог сохранить диагностику'; end if;
  raise notice 'OK: мастер сохраняет диагностику своего заказа';
end $$;

-- Не может: финансы (колоночный триггер)
do $$ begin
  begin
    update orders set prepayment = 9999;
    raise exception 'FAIL: мастер изменил предоплату';
  exception when others then
    if sqlerrm like '%Мастеру доступны%' then raise notice 'OK: финансы мастеру запрещены';
    else raise; end if;
  end;
end $$;

-- Не может: создать заказ
do $$ begin
  begin
    perform public.create_order('{"name":"X","phone":"89990000009"}',
      format('{"category_id":"%s","brand_id":"%s"}',
        (select id from categories where name_normalized='смартфон'),
        (select id from brands limit 1))::jsonb,
      '{"claimed_defect":"X"}');
    raise exception 'FAIL: мастер создал заказ';
  exception when others then
    if sqlerrm like '%администратору и менеджеру%' then raise notice 'OK: создание заказа мастеру запрещено';
    else raise; end if;
  end;
end $$;

-- Не может: статус чужого заказа
do $$ begin
  begin
    perform public.change_status(current_setting('test.o2_id')::uuid, 'diagnostics', null);
    raise exception 'FAIL: мастер сменил чужой статус';
  exception when others then
    if sqlerrm like '%своих заказов%' then raise notice 'OK: чужой статус мастеру запрещён';
    else raise; end if;
  end;
end $$;

-- Может: статус своего заказа
select public.change_status((select id from orders limit 1), 'diagnostics', 'Начал');
do $$ begin
  if (select status from orders limit 1) <> 'diagnostics' then raise exception 'FAIL: статус не сменился'; end if;
  raise notice 'OK: мастер ведёт свой заказ по статусам';
end $$;

-- Не видит outbox и выручку
do $$ begin
  if (select count(*) from notification_outbox) <> 0 then raise exception 'FAIL: мастеру виден outbox'; end if;
  if (public.dashboard_stats()->>'revenue_total') is not null then raise exception 'FAIL: мастеру видна выручка'; end if;
  raise notice 'OK: outbox и выручка мастеру не видны';
end $$;

-- ===== Анонім =====
reset role;
select set_config('request.jwt.claim.sub', '', false);
select set_config('request.jwt.claims', '', false);
set role anon;
do $$ begin
  if (select count(*) from orders) <> 0 then raise exception 'FAIL: anon видит заказы'; end if;
  if (select count(*) from clients) <> 0 then raise exception 'FAIL: anon видит клиентов'; end if;
  raise notice 'OK: анониму не видно ничего';
end $$;

-- Публичный статус — только через Edge Function (service_role),
-- напрямую анониму функция недоступна даже со знанием токена
do $$ begin
  begin
    perform public.public_order_status('00000000000000000000000000000000');
    raise exception 'FAIL: anon может вызывать public_order_status';
  exception when insufficient_privilege then null;
  end;
  raise notice 'OK: public_order_status закрыта от анонима';
end $$;

-- ===== Деактивированный сотрудник =====
reset role;
update public.profiles set is_active = false where id = 'a0000000-0000-0000-0000-000000000004';
call test_login('a0000000-0000-0000-0000-000000000004', 'master');
set role authenticated;
do $$ begin
  if (select count(*) from orders) <> 0 then raise exception 'FAIL: деактивированный видит заказы'; end if;
  raise notice 'OK: деактивированный мастер отрезан от данных немедленно';
end $$;
reset role;
\echo RLS_ALL_OK
