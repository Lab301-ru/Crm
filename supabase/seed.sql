-- ============================================================
-- Seed: статусы, переходы, правила уведомлений, настройки,
-- демо-справочник с шаблонами доп-полей из постановки
-- ============================================================

-- ------------------------------------------------------------
-- Статусы (цвета — как привычные цветные статусы Workpan)
-- ------------------------------------------------------------
insert into public.statuses (code, label, color, sort, is_terminal) values
  ('new',               'Не принят',               '#9CA3AF', 10,  false),
  ('accepted',          'Принят',                  '#3B82F6', 20,  false),
  ('diagnostics',       'Диагностика',             '#8B5CF6', 30,  false),
  ('awaiting_approval', 'Ожидание согласования',   '#F59E0B', 40,  false),
  ('awaiting_parts',    'Ожидание запчастей',      '#F97316', 50,  false),
  ('in_repair',         'В ремонте',               '#06B6D4', 60,  false),
  ('ready',             'Готов',                   '#22C55E', 70,  false),
  ('issued',            'Выдан',                   '#14B8A6', 80,  true),
  ('declined',          'Отказ',                   '#EF4444', 90,  false),
  ('scrapped',          'Утиль',                   '#6B7280', 100, true)
on conflict (code) do nothing;

-- ------------------------------------------------------------
-- Разрешённые переходы (state machine из Этапа 1)
-- ------------------------------------------------------------
insert into public.status_transitions (from_code, to_code) values
  ('new', 'accepted'),
  ('new', 'declined'),
  ('accepted', 'diagnostics'),
  ('accepted', 'declined'),
  ('diagnostics', 'awaiting_approval'),
  ('diagnostics', 'in_repair'),
  ('diagnostics', 'ready'),            -- неисправность не подтвердилась
  ('diagnostics', 'declined'),
  ('awaiting_approval', 'awaiting_parts'),
  ('awaiting_approval', 'in_repair'),
  ('awaiting_approval', 'declined'),
  ('awaiting_parts', 'in_repair'),
  ('awaiting_parts', 'awaiting_approval'),
  ('awaiting_parts', 'declined'),
  ('in_repair', 'ready'),
  ('in_repair', 'awaiting_parts'),
  ('in_repair', 'awaiting_approval'),
  ('in_repair', 'declined'),
  ('ready', 'issued'),
  ('ready', 'in_repair'),              -- возврат на доработку
  ('declined', 'issued'),              -- возврат устройства без ремонта
  ('declined', 'scrapped')
on conflict do nothing;

-- ------------------------------------------------------------
-- Настройки организации (заполняются админом после установки)
-- ------------------------------------------------------------
insert into public.org_settings (id, name, order_prefix, default_warranty_days, receipt_disclaimer)
values (
  1,
  'Сервисный центр',
  'L',
  30,
  'Сервисный центр не несёт ответственности за данные, оставленные на устройстве. Невостребованное оборудование хранится 60 дней.'
)
on conflict (id) do nothing;

-- ------------------------------------------------------------
-- Правила уведомлений: {order_number} {status_label} {due_date}
-- {client_name} {tracking_url} — подставляются при доставке
-- ------------------------------------------------------------
insert into public.notification_rules (event_type, channel, enabled, template) values
  ('order_accepted', 'telegram', true,
   'Заказ {order_number} принят в работу. Следить за статусом: {tracking_url}'),
  ('order_accepted', 'email', true,
   'Здравствуйте, {client_name}! Ваш заказ {order_number} принят в работу. Следить за статусом: {tracking_url}'),
  ('order_accepted', 'phone_call', false, 'Позвонить: заказ {order_number} принят'),

  ('cost_approval', 'telegram', true,
   'Заказ {order_number}: диагностика завершена, требуется согласование стоимости. Мы свяжемся с вами, либо позвоните нам.'),
  ('cost_approval', 'email', true,
   'Здравствуйте, {client_name}! По заказу {order_number} завершена диагностика — требуется согласование стоимости ремонта.'),
  ('cost_approval', 'phone_call', true, 'Позвонить: согласовать стоимость по заказу {order_number}'),

  ('awaiting_parts', 'telegram', true,
   'Заказ {order_number}: ожидаем поступления запчастей. Плановая готовность: {due_date}.'),
  ('awaiting_parts', 'email', true,
   'Здравствуйте, {client_name}! Заказ {order_number} ожидает запчасти. Плановая готовность: {due_date}.'),
  ('awaiting_parts', 'phone_call', false, 'Позвонить: заказ {order_number} ждёт запчасти'),

  ('order_ready', 'telegram', true,
   'Заказ {order_number} готов! Ждём вас за устройством. {tracking_url}'),
  ('order_ready', 'email', true,
   'Здравствуйте, {client_name}! Ваш заказ {order_number} готов к выдаче.'),
  ('order_ready', 'phone_call', true, 'Позвонить: заказ {order_number} готов к выдаче'),

  ('order_issued', 'telegram', true,
   'Заказ {order_number} выдан. Спасибо, что выбрали нас!'),
  ('order_issued', 'email', true,
   'Здравствуйте, {client_name}! Заказ {order_number} выдан. Спасибо, что выбрали нас!'),
  ('order_issued', 'phone_call', false, 'Позвонить: заказ {order_number} выдан')
on conflict (event_type, channel) do nothing;

-- ------------------------------------------------------------
-- Демо-справочник: категории и шаблоны доп-полей из постановки
-- (админ свободно правит/дополняет; импорт добавит остальное)
-- ------------------------------------------------------------
do $$
declare
  v_cat uuid;
begin
  -- Смартфон
  insert into public.categories (name, sort) values ('Смартфон', 10)
  on conflict do nothing;
  select id into v_cat from public.categories where name_normalized = 'смартфон';
  if v_cat is not null then
    insert into public.field_templates (category_id, key, label, field_type, options, is_required, sort) values
      (v_cat, 'imei', 'IMEI', 'text', null, false, 10),
      (v_cat, 'device_password', 'Пароль устройства', 'text', null, false, 20),
      (v_cat, 'apple_id_status', 'Apple ID / Локатор', 'select',
        '["выключен","включён","не проверен","не применимо"]'::jsonb, false, 30)
    on conflict (category_id, key) do nothing;
  end if;

  -- Телевизор
  insert into public.categories (name, sort) values ('Телевизор', 20)
  on conflict do nothing;
  select id into v_cat from public.categories where name_normalized = 'телевизор';
  if v_cat is not null then
    insert into public.field_templates (category_id, key, label, field_type, options, is_required, sort) values
      (v_cat, 'diagonal', 'Диагональ, дюймы', 'number', null, false, 10),
      (v_cat, 'matrix_type', 'Тип матрицы', 'select',
        '["LED","OLED","QLED","LCD","плазма","другое"]'::jsonb, false, 20)
    on conflict (category_id, key) do nothing;
  end if;

  -- Кофемашина
  insert into public.categories (name, sort) values ('Кофемашина', 30)
  on conflict do nothing;
  select id into v_cat from public.categories where name_normalized = 'кофемашина';
  if v_cat is not null then
    insert into public.field_templates (category_id, key, label, field_type, options, is_required, sort) values
      (v_cat, 'brew_counter', 'Счётчик приготовлений', 'number', null, false, 10),
      (v_cat, 'machine_type', 'Тип кофемашины', 'select',
        '["автоматическая","рожковая","капсульная","капельная","другое"]'::jsonb, false, 20)
    on conflict (category_id, key) do nothing;
  end if;

  -- Робот-пылесос
  insert into public.categories (name, sort) values ('Робот-пылесос', 40)
  on conflict do nothing;
  select id into v_cat from public.categories where name_normalized = 'робот-пылесос';
  if v_cat is not null then
    insert into public.field_templates (category_id, key, label, field_type, options, is_required, sort) values
      (v_cat, 'battery_capacity', 'Ёмкость аккумулятора, мА·ч', 'number', null, false, 10),
      (v_cat, 'battery_state', 'Состояние батареи', 'select',
        '["хорошее","удовлетворительное","требует замены","не проверено"]'::jsonb, false, 20)
    on conflict (category_id, key) do nothing;
  end if;
end $$;
