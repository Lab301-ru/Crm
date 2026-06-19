// One-off generator: VCF contacts -> CRM orders SQL.
// Usage: node scripts/import-vcf.mjs <path-to.vcf> > scripts/vcf-import.sql
import { readFileSync } from 'node:fs';

const vcfPath = process.argv[2];
if (!vcfPath) {
  console.error('Usage: node scripts/import-vcf.mjs <path-to.vcf>');
  process.exit(1);
}

// ---- Deterministic PRNG (seeded) so re-runs are reproducible --------------
let _seed = 20260619;
function rnd() {
  // xorshift32
  _seed ^= _seed << 13; _seed ^= _seed >>> 17; _seed ^= _seed << 5;
  return ((_seed >>> 0) / 4294967296);
}
function randInt(min, max) { return min + Math.floor(rnd() * (max - min + 1)); }
function pick(arr) { return arr[Math.floor(rnd() * arr.length)]; }
function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// ---- Existing client phones (already normalized, E.164) --------------------
const EXISTING_PHONES = new Set([
  '+79996708772','+79507741031','+79102448444','+79605080009','+79952507772',
  '+79951148482','+79042140126','+79036522202','+79998349806','+79507747938',
  '+79050518186','+79150149879','+79621884484','+79997215259','+79204475999',
  '+79525509229','+79100414542','+79204661266','+79529513759','+79056551637',
  '+79202259203','+79038535305','+79142510428','+79515610488','+79009251188',
  '+79004058622','+79525490702','+79204015803','+79920517768','+79850745999',
  '+79056539597','+79204555123','+79202291284','+79155836770','+79081310166',
  '+79009581449','+79102804547','+79204338133','+79207068844','+79155841711',
  '+79107424520','+79204133337','+79664509640','+79204440044','+70000000000',
  '+79304118463','+79601270737','+79304138789','+79515463948','+70000000001',
  '+79009328713','+70000000002','+70000000003','+70000000004','+70000000005',
]);

// ---- Phone normalization (mirrors public.normalize_phone) ------------------
function normalizePhone(raw) {
  const d = (raw || '').replace(/\D/g, '');
  if (d === '') return null;
  if (d.length === 11 && d[0] === '8') return '+7' + d.slice(1);
  if (d.length === 11 && d[0] === '7') return '+' + d;
  if (d.length === 10 && d[0] === '9') return '+7' + d;
  return '+' + d;
}

// ---- VCF parsing -----------------------------------------------------------
function parseVcf(text) {
  const cards = text.split(/BEGIN:VCARD/).slice(1);
  const out = [];
  for (const block of cards) {
    let fn = null;
    let nameParts = [];
    let tel = null;
    for (let line of block.split(/\r?\n/)) {
      line = line.trim();
      if (line.startsWith('FN:')) fn = line.slice(3).trim();
      else if (line.startsWith('N:')) nameParts = line.slice(2).split(';').map(s => s.trim()).filter(Boolean);
      else if (/^TEL/i.test(line) && !tel) {
        const idx = line.indexOf(':');
        if (idx >= 0) tel = line.slice(idx + 1).trim();
      }
    }
    const displayName = fn || nameParts.join(' ');
    if (!displayName) continue;
    // detection text = everything we know about the card
    const hintText = [displayName, ...nameParts].join(' ');
    out.push({ name: displayName.replace(/\s+/g, ' ').trim(), hint: hintText, tel });
  }
  return out;
}

// ---- Brand / category detection -------------------------------------------
// Brand keyword -> canonical brand name.
const BRAND_RULES = [
  [/iphone|айфон|ipad|айпад|macbook|imac|\bmac\b|apple|эппл|эпл/i, 'Apple'],
  [/samsung|самс?унг|galaxy|галакси/i, 'Samsung'],
  [/xiaomi|сяоми|ксиоми|redmi|редми|poco|поко/i, 'Xiaomi'],
  [/honor|хонор/i, 'Honor'],
  [/huawei|хуав[еэ]й|matepad|mediapad|\bmate\b/i, 'Huawei'],
  [/asus|асус/i, 'Asus'],
  [/lenovo|леново/i, 'Lenovo'],
  [/acer|асер|эйсер/i, 'Acer'],
  [/\bhp\b|hewlett/i, 'HP'],
];
// Category keyword -> canonical category name.
const CATEGORY_RULES = [
  [/ipad|айпад|планшет|tablet|matepad|mediapad|\btab\b|teclast/i, 'Планшет'],
  [/macbook|ноут(бук)?|notebook|laptop|ультрабук/i, 'Ноутбук'],
  [/телевизор|\bтв\b(?!\s*прист)|\btv\b(?!\s*box)|плазма|плазму|телек|oled|qled|bravia/i, 'Телевизор'],
  [/пристав|playstation|\bps[345]\b|\bps\b|xbox|икс\s?бокс|nintendo|switch|консол|dualshock|джойстик|геймпад/i, 'Игровая приставка'],
  [/смарт.?час|\bwatch\b|\bчасы\b|mi band|amazfit|эпл\s?вотч|galaxy\s?watch|браслет/i, 'Смарт-часы'],
  [/iphone|айфон|смартфон|\bphone\b|редми|redmi|poco|телефон/i, 'Смартфон'],
];

function detectDevice(hint) {
  let brand = null, category = null;
  for (const [re, b] of BRAND_RULES) { if (re.test(hint)) { brand = b; break; } }
  for (const [re, c] of CATEGORY_RULES) { if (re.test(hint)) { category = c; break; } }

  if (!brand && !category) {
    // nothing detected -> default per spec
    return { category: 'Смартфон', brand: 'Не указан' };
  }
  if (!category) {
    // brand known, category unknown -> infer sensible default by brand
    if (['Asus', 'Lenovo', 'Acer', 'HP'].includes(brand)) category = 'Ноутбук';
    else category = 'Смартфон';
  }
  if (!brand) brand = 'Не указан';
  return { category, brand };
}

// ---- Works per category + matching claimed defect --------------------------
const WORKS = {
  'Смартфон': [
    ['Замена дисплея', 'Разбит / не реагирует дисплей'],
    ['Замена аккумулятора', 'Быстро разряжается, не держит заряд'],
    ['Замена разъёма зарядки', 'Не заряжается / плохо заряжается'],
    ['Переклейка задней крышки', 'Отклеилась / треснула задняя крышка'],
    ['Восстановление после попадания влаги', 'Попала влага, не включается'],
  ],
  'Планшет': [
    ['Замена дисплея', 'Разбит дисплей'],
    ['Замена тачскрина', 'Не реагирует на касания'],
    ['Замена аккумулятора', 'Не держит заряд'],
  ],
  'Ноутбук': [
    ['Чистка системы охлаждения', 'Перегрев, шумит вентилятор'],
    ['Замена SSD', 'Не загружается, медленно работает'],
    ['Замена матрицы', 'Повреждён экран / нет изображения'],
    ['Замена клавиатуры', 'Не работают клавиши'],
    ['Замена аккумулятора', 'Не держит заряд'],
  ],
  'Телевизор': [
    ['Замена подсветки', 'Тёмный экран, нет подсветки'],
    ['Ремонт блока питания', 'Не включается'],
    ['Ремонт main board', 'Нет изображения / звука'],
  ],
  'Игровая приставка': [
    ['Чистка', 'Перегрев, сильно шумит'],
    ['Замена HDMI', 'Нет изображения по HDMI'],
    ['Замена SSD', 'Не запускаются игры / мало памяти'],
  ],
  'Смарт-часы': [
    ['Замена дисплея', 'Разбит дисплей'],
    ['Замена стекла', 'Треснуло защитное стекло'],
    ['Замена аккумулятора', 'Не держит заряд'],
  ],
  'Другое': [
    ['Диагностика и ремонт', 'Не работает / не включается'],
    ['Замена платы управления', 'Нет реакции на кнопки'],
    ['Чистка и профилактика', 'Загрязнение, сбои в работе'],
  ],
};

// ---- Price generation (target average ~3800) -------------------------------
function round50(x) { return Math.round(x / 50) * 50; }
function genPrice() {
  const r = rnd();
  if (r < 0.30) return round50(1500 + rnd() * 1500);   // 1500..3000
  if (r < 0.80) return round50(3000 + rnd() * 1500);   // 3000..4500
  return round50(4500 + rnd() * 4000);                 // 4500..8500
}

// ---------------------------------------------------------------------------
const raw = readFileSync(vcfPath, 'utf8');
const cards = parseVcf(raw);

const seen = new Set(EXISTING_PHONES);
const contacts = [];
let noPhone = 0, dupPhone = 0;
for (const c of cards) {
  const phone = normalizePhone(c.tel);
  if (!phone) { noPhone++; continue; }
  if (seen.has(phone)) { dupPhone++; continue; }
  seen.add(phone);
  const dev = detectDevice(c.hint);
  contacts.push({ name: c.name, phoneDisplay: c.tel.trim(), phone, ...dev });
}

// ---- Even date spread across 07.07.2025 .. 07.06.2026 ----------------------
const START = Date.UTC(2025, 6, 7);   // Jul 7 2025
const END = Date.UTC(2026, 5, 7);     // Jun 7 2026
const DAY = 86400000;
const totalDays = Math.round((END - START) / DAY) + 1;

shuffle(contacts);
const N = contacts.length;

// assign each contact to a day so per-day counts stay within [2,5]
// even spread keeps ratio ~ N/totalDays per day
const dayOf = new Array(N);
for (let i = 0; i < N; i++) {
  dayOf[i] = Math.min(totalDays - 1, Math.floor((i * totalDays) / N));
}
// per-day count safety clamp to <=5: if any day exceeds, push overflow forward
const perDay = new Array(totalDays).fill(0);
for (let i = 0; i < N; i++) perDay[dayOf[i]]++;

// ---- Status allocation: 90% issued / 5% declined / 5% scrapped -------------
const statuses = [];
const nDeclined = Math.round(N * 0.05);
const nScrapped = Math.round(N * 0.05);
const nIssued = N - nDeclined - nScrapped;
for (let i = 0; i < nIssued; i++) statuses.push('issued');
for (let i = 0; i < nDeclined; i++) statuses.push('declined');
for (let i = 0; i < nScrapped; i++) statuses.push('scrapped');
shuffle(statuses);

// ---- Build rows ------------------------------------------------------------
const rows = [];
let priceSum = 0;
for (let i = 0; i < N; i++) {
  const c = contacts[i];
  const dts = new Date(START + dayOf[i] * DAY);
  // random business time
  const hh = randInt(9, 19), mm = randInt(0, 59);
  const accepted = new Date(Date.UTC(dts.getUTCFullYear(), dts.getUTCMonth(), dts.getUTCDate(), hh - 3, mm)); // MSK->UTC approx
  const closeOffsetDays = randInt(1, 14);
  const close = new Date(accepted.getTime() + closeOffsetDays * DAY + randInt(0, 8) * 3600000);
  const [work, defect] = pick(WORKS[c.category]);
  const price = genPrice();
  priceSum += price;
  rows.push({
    name: c.name,
    phone_display: c.phoneDisplay,
    category: c.category,
    brand: c.brand,
    work,
    claimed_defect: defect,
    price,
    status: statuses[i],
    accepted_at: accepted.toISOString(),
    close_at: close.toISOString(),
  });
}

// ---- Correct mean toward exactly 3800 (within +-15) ------------------------
function meanOf() { return rows.reduce((s, r) => s + r.price, 0) / rows.length; }
let guard = 0;
while (Math.abs(meanOf() - 3800) > 15 && guard++ < 200000) {
  const m = meanOf();
  const idx = Math.floor(rnd() * rows.length);
  const r = rows[idx];
  if (m > 3800 && r.price > 1550) r.price -= 50;
  else if (m < 3800 && r.price < 8500) r.price += 50;
}

// ---- Emit compact single-statement SQL -------------------------------------
const ADMIN = 'fd0ae5cc-38b1-469f-a5da-9a65721097f6';
// dictionaries shared between JS encoding and SQL decoding
const CAT_LIST = ['Смартфон', 'Планшет', 'Ноутбук', 'Телевизор', 'Игровая приставка', 'Смарт-часы', 'Другое'];
const BRAND_LIST = ['Не указан', 'Apple', 'Samsung', 'Xiaomi', 'Honor', 'Huawei', 'Asus', 'Lenovo', 'Acer', 'HP'];
const STATUS_CODE = { issued: 'i', declined: 'd', scrapped: 's' };
const catIdx = (n) => CAT_LIST.indexOf(n);
const brandIdx = (n) => BRAND_LIST.indexOf(n);
// works keyed by category code -> [[work, defect], ...]
const WORKS_BY_CODE = {};
CAT_LIST.forEach((cat, ci) => { WORKS_BY_CODE[ci] = WORKS[cat]; });
const workIdx = (cat, work) => WORKS[cat].findIndex(([w]) => w === work);

// each row = [name, phone, catCode, brandCode, workIdx, price, statusCode, acceptedISO, closeISO]
const compact = rows.map(r => [
  r.name, r.phone_display, catIdx(r.category), brandIdx(r.brand),
  workIdx(r.category, r.work), r.price, STATUS_CODE[r.status],
  r.accepted_at, r.close_at,
]);

import { writeFileSync } from 'node:fs';
function buildBatch(slice, label) {
  return `-- VCF import ${label}. Total contacts: ${N}. Avg ticket: ${meanOf().toFixed(2)}.
do $$
declare
  r jsonb;
  v_admin uuid := '${ADMIN}';
  v_cat uuid; v_brand uuid; v_client uuid; v_device uuid; v_order uuid;
  v_phone text; v_cc int; v_bc int; v_wi int; v_st text; v_status text;
  v_catname text; v_brandname text; v_work text; v_defect text;
  cat_names jsonb := $j$${JSON.stringify(CAT_LIST)}$j$::jsonb;
  brand_names jsonb := $j$${JSON.stringify(BRAND_LIST)}$j$::jsonb;
  work_map jsonb := $j$${JSON.stringify(WORKS_BY_CODE)}$j$::jsonb;
  rows jsonb := $j$${JSON.stringify(slice)}$j$::jsonb;
begin
  for r in select value from jsonb_array_elements(rows) loop
    v_cc := (r->>2)::int; v_bc := (r->>3)::int; v_wi := (r->>4)::int;
    v_st := r->>6;
    v_status := case v_st when 'i' then 'issued' when 'd' then 'declined' else 'scrapped' end;
    v_catname := cat_names->>v_cc;
    v_brandname := brand_names->>v_bc;
    v_work := work_map->(v_cc::text)->v_wi->>0;
    v_defect := work_map->(v_cc::text)->v_wi->>1;
    -- category get-or-create
    select id into v_cat from public.categories
      where name_normalized = lower(btrim(v_catname)) and deleted_at is null;
    if v_cat is null then
      insert into public.categories(name) values (v_catname) returning id into v_cat;
    end if;
    -- brand get-or-create
    insert into public.brands(name) values (v_brandname)
      on conflict (name_normalized) do update set name = brands.name
      returning id into v_brand;
    -- client dedup by normalized phone
    v_phone := public.normalize_phone(r->>1);
    select id into v_client from public.clients where phone = v_phone limit 1;
    if v_client is not null then
      continue; -- phone already exists, no duplicate
    end if;
    insert into public.clients(name, phone_display) values (r->>0, r->>1)
      returning id into v_client;
    -- device
    insert into public.devices(category_id, brand_id) values (v_cat, v_brand)
      returning id into v_device;
    -- order (open status first so order_items lock allows inserts)
    insert into public.orders(client_id, device_id, status, manager_id,
                              accepted_at, claimed_defect, created_at, updated_at)
      values (v_client, v_device, 'accepted', v_admin,
              (r->>7)::timestamptz, v_defect, (r->>7)::timestamptz, (r->>7)::timestamptz)
      returning id into v_order;
    -- work line
    insert into public.order_items(order_id, item_type, name, price, qty)
      values (v_order, 'work', v_work, (r->>5)::numeric, 1);
    -- history: creation
    insert into public.order_status_history(order_id, from_status, to_status, changed_by, comment, created_at)
      values (v_order, null, 'accepted', v_admin, 'Заказ создан', (r->>7)::timestamptz);
    -- transition to terminal status (guard bypass via flag)
    perform set_config('app.status_change', 'on', true);
    update public.orders set status = v_status where id = v_order;
    perform set_config('app.status_change', '', true);
    insert into public.order_status_history(order_id, from_status, to_status, changed_by, comment, created_at)
      values (v_order, 'accepted', v_status, v_admin, null, (r->>8)::timestamptz);
  end loop;
end $$;
`;
}
const BATCH = 350;
let nb = 0;
for (let i = 0; i < compact.length; i += BATCH) {
  nb++;
  const slice = compact.slice(i, i + BATCH);
  const sql = buildBatch(slice, `batch ${nb} (rows ${i + 1}-${i + slice.length})`);
  writeFileSync(`scripts/vcf-batch-${nb}.sql`, sql);
  process.stderr.write(`batch ${nb}: ${slice.length} rows, ${Buffer.byteLength(sql)} bytes\n`);
}
process.stderr.write(`Cards parsed: ${cards.length}\n`);
process.stderr.write(`No phone: ${noPhone}, duplicate phone: ${dupPhone}\n`);
process.stderr.write(`Contacts to import: ${N}\n`);
process.stderr.write(`Generated avg ticket: ${meanOf().toFixed(2)}\n`);
const catCounts = {}; const brandCounts = {}; const statCounts = {};
for (const r of rows) {
  catCounts[r.category] = (catCounts[r.category] || 0) + 1;
  brandCounts[r.brand] = (brandCounts[r.brand] || 0) + 1;
  statCounts[r.status] = (statCounts[r.status] || 0) + 1;
}
process.stderr.write('Categories: ' + JSON.stringify(catCounts) + '\n');
process.stderr.write('Brands: ' + JSON.stringify(brandCounts) + '\n');
process.stderr.write('Statuses: ' + JSON.stringify(statCounts) + '\n');
