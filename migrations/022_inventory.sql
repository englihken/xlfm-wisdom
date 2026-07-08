-- =====================================================================================
-- 022_inventory.sql — INVENTORY WING (结缘品 warehouse + per-centre stock)
-- =====================================================================================
-- PURPOSE
--   New inventory module for 结缘品 stock: 善书/books, 念佛机, 计数器, 无烟香, flyers,
--   米袋, 环保袋 etc. Source of truth is a MOVEMENTS LEDGER; balances are derived per
--   location (总会仓库 + one location per active centre). Catalog + opening balances
--   seeded from Ken's 仓库书籍 RECORD .xlsx (sheet 仓库记录, column "As on 2/03/2026").
--
-- DESIGN
--   inventory_items      — catalog (legacy StockID kept; 19 uncoded items have stock_id NULL)
--   inventory_locations  — 1 x hq_warehouse (总会仓库) + 1 per active centre
--   inventory_movements  — append-style ledger; direction rules enforced by CHECK:
--                            opening/stock_in/adjust_in    : -> to_location only
--                            distribution/adjust_out       : from_location -> (out of system)
--                            transfer/return               : from_location -> to_location
--                          optional event_id ties 结缘 outflow to a 法会.
--   inventory_requests   — 分会 orders: qty_requested vs qty_fulfilled (backorder = difference)
--   inventory_balances   — VIEW (security_invoker): per item x location derived qty
--
--   RLS: house pattern — SELECT policies via has_module_access('inventory','view');
--        writes stay service-role mediated (same as events wing).
--   Role grants mirror finance: admin=admin, erp_admin=admin, committee=view.
--
--   OPENING BALANCES are provisional ("unverified" note on every opening movement):
--   seeded from the newest spreadsheet column (2/03/2026), to be corrected via
--   stock-take adjustments (adjust_in / adjust_out) in the app.
-- =====================================================================================

-- ---------- 1. TABLES ----------

create table public.inventory_items (
  id          uuid primary key default gen_random_uuid(),
  stock_id    text unique,
  name_cn     text not null,
  remark      text,
  pack_qty    integer check (pack_qty > 0),
  category    text,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table public.inventory_locations (
  id          uuid primary key default gen_random_uuid(),
  kind        text not null check (kind in ('hq_warehouse','centre')),
  centre_id   uuid references public.centres(id),
  name_cn     text not null,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  constraint inventory_locations_kind_centre_check check ((kind = 'centre') = (centre_id is not null))
);
create unique index inventory_locations_centre_uniq on public.inventory_locations(centre_id) where centre_id is not null;
create unique index inventory_locations_hq_uniq on public.inventory_locations(kind) where kind = 'hq_warehouse';

create table public.inventory_movements (
  id                uuid primary key default gen_random_uuid(),
  item_id           uuid not null references public.inventory_items(id),
  movement_type     text not null check (movement_type in
                      ('opening','stock_in','transfer','distribution','return','adjust_in','adjust_out')),
  from_location_id  uuid references public.inventory_locations(id),
  to_location_id    uuid references public.inventory_locations(id),
  qty               integer not null check (qty > 0),
  event_id          uuid references public.events(id),
  note              text,
  moved_at          date not null default current_date,
  created_by        uuid references public.volunteers(id),
  created_at        timestamptz not null default now(),
  constraint inventory_movements_direction_check check (
       (movement_type in ('opening','stock_in','adjust_in')
          and from_location_id is null and to_location_id is not null)
    or (movement_type in ('distribution','adjust_out')
          and from_location_id is not null and to_location_id is null)
    or (movement_type in ('transfer','return')
          and from_location_id is not null and to_location_id is not null
          and from_location_id <> to_location_id)
  )
);
create index inventory_movements_item_idx  on public.inventory_movements(item_id);
create index inventory_movements_from_idx  on public.inventory_movements(from_location_id);
create index inventory_movements_to_idx    on public.inventory_movements(to_location_id);
create index inventory_movements_event_idx on public.inventory_movements(event_id);

create table public.inventory_requests (
  id             uuid primary key default gen_random_uuid(),
  centre_id      uuid not null references public.centres(id),
  item_id        uuid not null references public.inventory_items(id),
  qty_requested  integer not null check (qty_requested > 0),
  qty_fulfilled  integer not null default 0 check (qty_fulfilled >= 0),
  status         text not null default 'pending' check (status in ('pending','partial','fulfilled','cancelled')),
  event_id       uuid references public.events(id),
  note           text,
  requested_at   date not null default current_date,
  created_by     uuid references public.volunteers(id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index inventory_requests_centre_idx on public.inventory_requests(centre_id);
create index inventory_requests_item_idx   on public.inventory_requests(item_id);

-- ---------- 2. BALANCES VIEW ----------

create view public.inventory_balances with (security_invoker = true) as
with flows as (
  select item_id, to_location_id as location_id, qty
    from public.inventory_movements where to_location_id is not null
  union all
  select item_id, from_location_id, -qty
    from public.inventory_movements where from_location_id is not null
)
select l.id       as location_id,
       l.kind     as location_kind,
       l.centre_id,
       l.name_cn  as location_name,
       i.id       as item_id,
       i.stock_id,
       i.name_cn  as item_name,
       i.category,
       i.pack_qty,
       coalesce(sum(f.qty), 0)::integer as qty
from public.inventory_locations l
cross join public.inventory_items i
left join flows f on f.location_id = l.id and f.item_id = i.id
group by l.id, l.kind, l.centre_id, l.name_cn, i.id, i.stock_id, i.name_cn, i.category, i.pack_qty;

-- ---------- 3. RLS (house pattern: module read; writes are service-role mediated) ----------

alter table public.inventory_items     enable row level security;
alter table public.inventory_locations enable row level security;
alter table public.inventory_movements enable row level security;
alter table public.inventory_requests  enable row level security;

create policy "inventory module can read items"     on public.inventory_items
  for select using (has_module_access('inventory','view'));
create policy "inventory module can read locations" on public.inventory_locations
  for select using (has_module_access('inventory','view'));
create policy "inventory module can read movements" on public.inventory_movements
  for select using (has_module_access('inventory','view'));
create policy "inventory module can read requests"  on public.inventory_requests
  for select using (has_module_access('inventory','view'));

-- ---------- 4. ROLE GRANTS (module 'inventory' already in role_grants module CHECK) ----------

insert into public.role_grants (role, module, access) values
  ('admin',     'inventory', 'admin'),
  ('erp_admin', 'inventory', 'admin'),
  ('committee', 'inventory', 'view')
on conflict (role, module) do nothing;

-- ---------- 5. SEED: LOCATIONS (总会仓库 + one per active centre) ----------

insert into public.inventory_locations (kind, centre_id, name_cn)
values ('hq_warehouse', null, '总会仓库');

insert into public.inventory_locations (kind, centre_id, name_cn)
select 'centre', c.id, c.name_cn
from public.centres c
where c.is_active = true;

-- ---------- 6. SEED: ITEM CATALOG (from 仓库书籍 RECORD .xlsx / 仓库记录) ----------

insert into public.inventory_items (stock_id, name_cn, remark, pack_qty, category) values
  ('S001B0101', '一命二运三风水', '玄艺综述问答录音', 20, 'S001'),
  ('S001B0201', '图腾世界', '通灵探索与玄艺综述问答录音', 20, 'S001'),
  ('S001B0301', '天地人', '玄艺综述问答录音', 20, 'S001'),
  ('S001B0401', '心灵法门例说', '实例与导读案例', 20, 'S001'),
  ('S001B0501', '法会殊胜感悟 1', '菩萨灵验', 30, 'S001'),
  ('S001B0601', '佛法新概念', '听众反馈事实', 20, 'S001'),
  ('S001B0701', '佛法新空间', '感悟与玄艺综述录音', 20, 'S001'),
  ('S001B0801', '佛子天地游记（一）', null, 20, 'S001'),
  ('S001B0802', '佛子天地游记（二）', null, 20, 'S001'),
  ('S001B0901', '佛子天地游记 01   英文', null, 20, 'S001'),
  ('S002B0101', '吃素戒杀放生（简）', null, 20, 'S002'),
  ('S002B0201', '素食菜谱', null, 20, 'S002'),
  ('S002B0301', '心灵素食谱(马来西亚版本)', 'OLD STOCK BALANCE 114, NEW ARRIVAL 01.08.2024 10000BOOKS', 50, 'S002'),
  ('S002B0302', '心灵素食谱(悉尼版本)', null, 50, 'S002'),
  ('S003B0101', '婚姻情感（一）', null, 20, 'S003'),
  ('S003B0102', '婚姻情感（二）', null, 20, 'S003'),
  ('S004B0101', '弟子开示（一）', null, 20, 'S004'),
  ('S004B0102', '弟子开示（二）', null, 20, 'S004'),
  ('S005B0101', '佛学常识（一）', null, 20, 'S005'),
  ('S005B0102', '佛学常识（二）', null, 20, 'S005'),
  ('S006B0101', '疾病百科（一）', null, 10, 'S006'),
  ('S006B0201', '治疗疾病（一）', null, 20, 'S006'),
  ('S006B0202', '治疗疾病（二）', null, 20, 'S006'),
  ('S007B0101', '弘法度人辅导手册', null, 20, 'S007'),
  ('S007B0201', '历年法会集锦2014（上）', null, 20, 'S007'),
  ('S007B0202', '弘法足迹法会集锦2014（中）', null, 30, 'S007'),
  ('S007B0203', '弘法足迹法会集锦2014（下）', null, 30, 'S007'),
  ('S008B0101', '萌宝 一', null, 100, 'S008'),
  ('S008B0102', '萌宝 二', null, 100, 'S008'),
  ('S008B0103', '萌宝 三', null, 100, 'S008'),
  ('S009B0101', '小房子指南 中文', null, 50, 'S009'),
  ('S009B0201', '小房子指南 英文', null, 50, 'S009'),
  ('S010B0101', '入门手册（简）', 'MY 只用简体， 除非有要求', 50, 'S010'),
  ('S010B0201', '入门手册（繁）', '外国只用繁体， 除非有要求', 50, 'S010'),
  ('S010B0301', 'Introduction to the Guan Yin Citta Dharma Door/英文入门手册', null, 30, 'S010'),
  ('S010B0401', 'Citta Dharma Door Color Book/英文介绍小册子', null, 50, 'S010'),
  ('S010B0501', '设佛台开示合集', 'MY版本', 30, 'S010'),
  ('S010B0601', '共圆中国梦', null, 50, 'S010'),
  ('S010B0602', '中国梦智慧心', null, null, 'S010'),
  ('S010B0701', '无上菩提', null, 20, 'S010'),
  ('S011B0101', '佛学问答(162)', null, 20, 'S011'),
  ('S011B0102', '佛学问答(164)', null, 20, 'S011'),
  ('S011B0103', '佛学问答(165)', null, 20, 'S011'),
  ('S011B0104', '佛学问答(166)', null, 20, 'S011'),
  ('S011B0105', '佛学问答(160)', null, null, 'S011'),
  ('S011B0201', 'Methaphysics Q&A  1/佛学问答1 英文', '东方台已经不出了，已经由QA166代替. confirmed by Khai Xin HQ via WhatsApp. 20190603', 50, 'S011'),
  ('S011B0202', 'Methaphysics Q&A  2/佛学问答2 英文', '东方台已经不出了，已经由QA166代替. confirmed by Khai Xin HQ via WhatsApp. 20190603', 50, 'S011'),
  ('S011B0203', 'Methaphysics Q&A  3/佛学问答3 英文', '东方台已经不出了，已经由QA166代替. confirmed by Khai Xin HQ via WhatsApp. 20190603', 50, 'S011'),
  ('S011B0301', 'Buddhism Q&A 166/佛学问答 166  英文', null, 20, 'S011'),
  ('S011B0401', '玄学 151 (繁体）', null, 20, 'S011'),
  ('S011B0402', '玄学 159 (繁体）', null, null, 'S011'),
  ('S011B0403', '玄学 157 (繁体）', null, 20, 'S011'),
  ('S012B0101', '白话佛法 01', null, 20, 'S012'),
  ('S012B0102', '白话佛法 02', null, 20, 'S012'),
  ('S012B0103', '白话佛法 03', null, 20, 'S012'),
  ('S012B0104', '白话佛法 04', null, 20, 'S012'),
  ('S012B0105', '白话佛法 05', null, 20, 'S012'),
  ('S012B0106', '白话佛法 06', null, 20, 'S012'),
  ('S012B0107', '白话佛法 07', null, 20, 'S012'),
  ('S012B0108', '白话佛法 08', null, 20, 'S012'),
  ('S012B0109', '白话佛法 09', null, 20, 'S012'),
  ('S012B0110', '白话佛法 10', null, 20, 'S012'),
  ('S012B0111', '白话佛法 11', null, 20, 'S012'),
  ('S012B0112', '白话佛法 12', null, 20, 'S012'),
  ('S012B0201', '白话佛法 01（繁体）', null, null, 'S012'),
  ('S012B0301', '白话佛法（一）（汉语拼音）上', null, 20, 'S012'),
  ('S012B0302', '白话佛法（一）（汉语拼音）下', null, 20, 'S012'),
  ('S012B0401', '白话佛法（一）精装版', null, 20, 'S012'),
  ('S012B0402', '白话佛法（一）精装版 （SLIP POCKET COVER）', null, null, 'S012'),
  ('S012B0501', '白话广播（一）', null, 20, 'S012'),
  ('S012B0502', '白话广播（二）', null, 20, 'S012'),
  ('S012B0601', '白话佛法 视频开示 01', null, 20, 'S012'),
  ('S012B0602', '白话佛法 视频开示 02', null, 20, 'S012'),
  ('S012B0603', '白话佛法 视频开示 03', null, 20, 'S012'),
  ('S012B0604', '白话佛法 视频开示 04', null, 20, 'S012'),
  ('S012BE1', '白话佛法 习题(八)', null, null, 'S012'),
  ('S012BE101', '白话佛法 习题(一）', null, 50, 'S012'),
  ('S012BE102', '白话佛法 习题(二)', null, 50, 'S012'),
  ('S012BE103', '白话佛法 习题(三)', null, 50, 'S012'),
  ('S012BE104', '白话佛法 习题(四)', null, null, 'S012'),
  ('S012BE105', '白话佛法 习题(五)', null, null, 'S012'),
  ('S012BE106', '白话佛法 习题(六)', null, null, 'S012'),
  ('S012BE107', '白话佛法 习题(七)', null, null, 'S012'),
  ('S012BE109', '白话佛法 习题(九)', null, null, 'S012'),
  ('S012BE110', '白话佛法 习题(十)', null, null, 'S012'),
  ('S012BE111', '白话佛法 习题(十一)', null, null, 'S012'),
  ('S101B0101', '佛言佛语 01 中文版 A5 小册子', null, 50, 'S101'),
  ('S101B0102', '佛言佛语 02 中文版 A5 小册子', null, 50, 'S101'),
  ('S101B0103', '佛言佛语 03 中文版 A5 小册子', null, 50, 'S101'),
  ('S101B0104', '佛言佛语 04 中文版 A5 小册子', null, 50, 'S101'),
  ('S101B0105', '佛言佛语 05 中文版 A5 小册子', null, 50, 'S101'),
  ('S101B0106', '佛言佛语 06 中文版 A5 小册子', null, 50, 'S101'),
  ('S101B0107', '佛言佛语 07 中文版 A5 小册子', null, 50, 'S101'),
  ('S101B0108', '佛言佛语 08 中文版 A5 小册子', null, 50, 'S101'),
  ('S101B0109', '佛言佛语 09 中文版 A5 小册子', null, null, 'S101'),
  ('S101B0110', '佛言佛语 10 中文版 A5 小册子', 'Hard Cover', null, 'S101'),
  ('S101B0111', '佛言佛语 11 中文版 A5 小册子', 'Hard Cover', null, 'S101'),
  ('S101B0112', '佛言佛语 12 中文版 A5 小册子', 'Hard Cover', null, 'S101'),
  ('S101B0113', '佛言佛语 13 中文版 A5 小册子', 'Hard Cover', null, 'S101'),
  ('S101B0114', '佛言佛语 14 中文版 A5 小册子', 'Hard Cover', null, 'S101'),
  ('S101B0201', '佛言佛语 01 中英文版 A5 小册子 （繁体）', null, 50, 'S101'),
  ('S101B0202', '佛言佛语 02 中英文版 A5 小册子 （繁体）', null, 20, 'S101'),
  ('S101B0203', '佛言佛语 03 中英文版 A5 小册子 （繁体）', null, 50, 'S101'),
  ('S101B0204', '佛言佛语 04 中英文版 A5 小册子 （繁体）', null, 30, 'S101'),
  ('S101B0205', '佛言佛语 05 中英文版 A5 小册子 （繁体）', null, 30, 'S101'),
  ('S101B0206', '佛言佛语 06 中英文版 A5 小册子 （繁体）', null, 30, 'S101'),
  ('S101B0207', '佛言佛语 07 中英文版 A5 小册子 （繁体）', null, 20, 'S101'),
  ('S101B0208', '佛言佛语 08 中英文版 A5 小册子 （繁体）', null, 20, 'S101'),
  ('S101B0209', '佛言佛语 09 中英文版 A5 小册子 （繁体）', null, 20, 'S101'),
  ('S101B0301', '佛言佛语 A6 小册子', null, 200, 'S101'),
  ('S101B0401', '佛言偈语（一）', null, 50, 'S101'),
  ('S101B0402', '佛言偈语（二）', null, 60, 'S101'),
  ('S101B0403', '佛言偈语（三）', '佛陀无上智慧精华', 60, 'S101'),
  ('S101B0501', '心灵禅语（一）', null, 50, 'S101'),
  ('S101B0502', '心灵禅语（二）', null, 60, 'S101'),
  ('S101B0601', '佛言偈语（三）精装版', '经典开示所精选集结成册', null, 'S101'),
  ('S101P0101', '佛言佛语 - 书签', null, null, 'S101'),
  ('S201B0101', '小本 经书（简体)', null, 100, 'S201'),
  ('S201B0201', '小本 经书（简体/QR Code/NM)【不出国】', null, 100, 'S201'),
  ('S201B0301', '小本 经书英文（简体）', '（红，简体/拼音/旧版/本地) | For Free Distribution Only/ Not For Sale /免费结缘 | [出货外国的都是旧版，不用QR Code ]', 100, 'S201'),
  ('S201B0302', '小本 经书英文 （简体/NM）【不出国】', '（红，简体/拼音/QR Code )|For non-muslim only/ For Free Distribution Only / Not For Sale/免费结缘
[NM字眼不出国，不用QR Code ]', 100, 'S201'),
  ('S201B0401', '小本 经书英文（繁体）', '（红，简体/拼音/英文）| 免费结缘', 100, 'S201'),
  ('S201B0501', '大本 经书（简体)', '（红，简体/拼音/英文）|For non-muslim only/ For Free Distribution Only / Not For Sale/免费结缘
[NM字眼不出国]', 100, 'S201'),
  ('S201B0502', '大本 经书（简体)', '（红，繁体/拼音/英文）|www.GuanYinCitta.com/For Free Distribution Only /Not For Sale/ 免费结缘', null, 'S201'),
  ('S201B0601', '小本 经书（深褐，繁体 台湾版本/国语注音)', '（红，简体/拼音)|For Free Distribution Only/ Not For Sale/免费结缘', 100, 'S201'),
  ('S201B0701', '小本 经书（浅褐，简体 SYDNEY版本)', '（红，简体/拼音/现代语)|免费赠送/欢迎翻印/常修善法/灾消福增', 50, 'S201'),
  ('S201B0801', '小本 经书（蓝，简体/拼音  东方台版本)', null, 100, 'S201'),
  ('S201B0901', '小 经书套', null, 200, 'S201'),
  ('S201B0902', '大 经书套', null, 200, 'S201'),
  ('S203P0101', '折叠礼佛卡', null, 100, 'S203'),
  ('S203P0102', '折叠礼佛卡(rejected, to be advised and put sticker)', null, null, 'S203'),
  ('S203P0201', '礼佛卡（大）', null, 100, 'S203'),
  ('S203P0202', 'A4 礼佛大忏悔文', null, null, 'S203'),
  ('S301P0101', 'A4 每日功课步骤', null, 100, 'S301'),
  ('S301P0102', 'A4 每日功课步骤 + 小房子念诵方法与注意事项(中文)', null, null, 'S301'),
  ('S301P0103', 'A4 每日功课步骤 + 小房子念诵方法与注意事项(英文)', null, null, 'S301'),
  ('S301P0201', 'A4 小房子念诵方法与注意事项(初学者)', null, 100, 'S301'),
  ('S301P0202', 'A6 烧送小房子程序', null, 3000, 'S301'),
  ('S301P0203', 'A6 念小房子之前的注意事项', null, 3000, 'S301'),
  ('S301P0204', 'A4 烧送XFZ程序', null, null, 'S301'),
  ('S301P0301', 'A4 劝导升文(黄色纸)', null, 100, 'S301'),
  ('S301P0302', 'A4 正名升文(黄色纸)', null, 100, 'S301'),
  ('S301P0303', 'A4 改名升文(黄色纸)', null, 100, 'S301'),
  ('S301P0304', 'A6 改名升文的程序/许愿的程序', null, 100, 'S301'),
  ('S301P0401', 'A6 放生时的祈求', null, 100, 'S301'),
  ('S301P0501', 'A4 佛台摆放方式', null, 100, 'S301'),
  ('S301P0601', 'A5 礼佛程序', null, null, 'S301'),
  ('S302P0101', 'A4 弟子守则', null, null, 'S302'),
  ('S401P0101', '空白小房子', null, 3000, 'S401'),
  ('S401P0201', '自修大悲咒 （1102遍）', null, 100, 'S401'),
  ('S401P0202', '自修大悲咒（272遍）', '《大悲咒27 心经49 往生咒84 七佛87》', 3000, 'S401'),
  ('S401P0301', '自修心经（1102遍）', null, 100, 'S401'),
  ('S401P0302', '自修心经（272遍）', null, 3000, 'S401'),
  ('S401P0401', '自修往生咒（272遍）', null, 3000, 'S401'),
  ('S401P0501', '自修准提神咒 （272遍）', null, 3000, 'S401'),
  ('S401P0601', '自修消灾吉祥神咒（1102遍）', null, 100, 'S401'),
  ('S401P0602', '自修消灾吉祥神咒（272遍）', null, 3000, 'S401'),
  ('S401P0701', '自修功德宝山神咒（272遍）', null, 3000, 'S401'),
  ('S401P0801', '自存礼佛大忏悔文（9遍）', null, 3000, 'S401'),
  ('S401P0802', '自存礼佛大忏悔文（12遍）', null, 3000, 'S401'),
  ('S401P0803', '自存礼佛大忏悔文（21遍）', null, 3000, 'S401'),
  ('S401P0804', '自存礼佛大忏悔文（27遍）', null, 3000, 'S401'),
  ('S401P0805', '自存礼佛大忏悔文（49遍）', null, 3000, 'S401'),
  ('S501P0101', '东方台名片', null, 100, 'S501'),
  ('S501P0201', '宣传单-中文-世界和平大使', null, 100, 'S501'),
  ('S501P0202', '宣传单-中文-念经有不可思议的力量', null, 1000, 'S501'),
  ('S501P0203', '宣传单-中文-解决咒 (12.04.2019出版）', null, 2400, 'S501'),
  ('S501P0204', '宣传单-中文-心经(12.04.2019出版）', null, 2400, 'S501'),
  ('S501P0205', '宣传单-中文-准提神咒 (20.08.2019出版）', 'A4 / 3折叠 / 有颜色', 2400, 'S501'),
  ('S501P0206', '宣传单-中文-消灾吉祥神咒 (07.2022 出版)', 'A4 / 3折叠 / 有颜色', null, 'S501'),
  ('S501P0207', '宣传单-中文-往生咒', 'A4 / 3折叠 / 有颜色', null, 'S501'),
  ('S501P0208', '宣传单-中文-小房子', 'A4 / 3折叠 / 有颜色', null, 'S501'),
  ('S501P0301', '宣传单-英文', 'A4 / 3折叠 / 有颜色', 100, 'S501'),
  ('S501P0401', '佛学报', 'A4 / 3折叠 / 有颜色', 100, 'S501'),
  ('S501P0501', '《卢军宏台长太平绅士》2018 小册子', 'A4 / 没折叠 / 有颜色', 100, 'S501'),
  ('S501P0601', '宣传单-中文-生活"急救"锦囊', null, 60, 'S501'),
  ('S501P0602', '宣传单-英文-Remedies in Times of Emergency in Everyday Life', null, null, 'S501'),
  ('S601C0101', 'CD  教念版', null, 50, 'S601'),
  ('S601C0102', 'MP3 白话佛法 vol 3 (2010.09 - 2017.01)', null, 50, 'S601'),
  ('S601D0101', 'DVD 2011 马来西亚,吉隆坡 28.08.2011 (DVD封面是英文）', null, 50, 'S601'),
  ('S601D0102', 'DVD 2013/2014 中国,香港', null, 50, 'S601'),
  ('S601D0103', 'DVD 2014 中国,香港 22.06.2014', '(英文字幕）', 50, 'S601'),
  ('S601D0104', 'DVD 2015 马来西亚,沙巴 18.01.2015', '(中文字幕）', 50, 'S601'),
  ('S601D0105', 'DVD 2015 马来西亚,槟城 24.01.2015', '(中文字幕）', 50, 'S601'),
  ('S601D0106', 'DVD 2015 中国,香港 20.06.2015', '(中文字幕）', 50, 'S601'),
  ('S601D0107', 'DVD 2015 马来西亚法会,柔佛', '(中文字幕）', 50, 'S601'),
  ('S601D0108', 'DVD 2015 马来西亚,吉隆坡 13.12.2015', '(中文字幕）', 50, 'S601'),
  ('S601D0109', 'DVD 2016 印尼,巴淡岛', '(中文字幕）22.8.2015', 50, 'S601'),
  ('S601D0110', 'DVD 2016 新加坡 23.04.2016', '(中文字幕）', 50, 'S601'),
  ('S601D0111', 'DVD 2016 中国,香港 03.07.2016', '(中文字幕）17.02.2016', 50, 'S601'),
  ('S601D0112', 'DVD 2016 马来西亚,槟城 13.08.2016', '(中文字幕）', 50, 'S601'),
  ('S601D0113', 'DVD 2016 马来西亚,马六甲 20.08.2016', '(中文字幕）', 50, 'S601'),
  ('S601D0114', 'DVD 2016 马来西亚,吉隆坡 25.12.2016', '(中文字幕）', 50, 'S601'),
  ('S601D0115', 'DVD 2017 新加坡 18.02.2017 (DVD封面是中文）', '(中文字幕）', 50, 'S601'),
  ('S601D0116', 'DVD 2017 新加坡 18.02.2017 (DVD封面是英文）', '(中文字幕）', 50, 'S601'),
  ('S601D0117', 'DVD 2017 马来西亚,吉隆坡 27.08.2017', '(中文字幕）', 50, 'S601'),
  ('S601D0118', 'DVD 2018 澳大利亚,悉尼 11.02.2018', '(英文字幕）', 50, 'S601'),
  ('S601D0119', 'DVD 2015 马来西亚,吉隆坡 12.12.2015
[不允许出货, 如果想问详情，请咨询总会]', '(中文字幕）', null, 'S601'),
  ('S601DC101', 'DVD Cover 白色', '(中文字幕）', 100, 'S601'),
  ('S601DC102', 'DVD Cover 紫色', null, 100, 'S601'),
  ('S601DC103', 'DVD Cover 红色', null, 100, 'S601'),
  ('S601DC104', 'DVD Cover 黄色', null, 100, 'S601'),
  ('S601DC105', 'DVD Cover 青色', null, 100, 'S601'),
  ('S601DC106', 'DVD Cover 蓝色', null, 100, 'S601'),
  ('S901Q0101', '扇子 （已贴）', null, 250, 'S901'),
  ('S901Q0102', '扇子 （未贴）', null, 1000, 'S901'),
  ('S901Q0103', '扇子 （已贴）2022年7月', null, null, 'S901'),
  ('S901Q0301', '贴纸 心形-感恩吃素', null, null, 'S901'),
  ('S901Q0401', '日历 - 2024年', null, null, 'S901'),
  ('L001-A01-01', 'Postface\Generosity (1)(2)', null, null, 'L001'),
  ('L001-A01-02', 'Postface\Generosity (3)', null, null, 'L001'),
  ('L001-A01-03', 'Postface\Generosity (1)(2)', null, null, 'L001'),
  ('L001-A02-01', '后记 (一)', null, null, 'L001'),
  ('L001-A02-02', '后记 (二)(三)', null, null, 'L001'),
  ('L001-A02-03', '后记 (结善缘)(一)', null, null, 'L001'),
  ('L001-A02-04', '后记 (结善缘) (二)(三)', null, null, 'L001'),
  ('L001-A02-05', '后记 (结善缘)(一)(二)', null, null, 'L001'),
  ('L001-A02-06', '后记 (结善缘) (三)', null, null, 'L001'),
  ('L001-A02-07', '佛教经典组合XFZ念诵指南', null, null, 'L001'),
  ('S901Q0201', '环保袋', null, 25, 'S901'),
  (null, 'A4 每日功课步骤 （中英文） NEW 01.08.2024', 'NEW arrival 01.08.2024', null, 'uncoded'),
  (null, '宣传书- COMIC 书', 'NEW arrival 01.08.2024', 30, 'uncoded'),
  (null, '新漫画 《今天把心洗一洗》', null, 50, 'uncoded'),
  (null, '扇子 sticker而已（前和后）', null, null, 'uncoded'),
  (null, '感恩sticker (大张)', null, null, 'uncoded'),
  (null, 'A5 红信封  (一叠）', null, null, 'uncoded'),
  (null, '纸信封', null, null, 'uncoded'),
  (null, '红信封  + A3 红信封  (一叠）', null, null, 'uncoded'),
  (null, '无烟香（法会数量）', null, null, 'uncoded'),
  (null, '后记 （1,2,3）', null, null, 'uncoded'),
  (null, '抹经书套的布', null, null, 'uncoded'),
  (null, '计数器', null, null, 'uncoded'),
  (null, '念佛机', null, null, 'uncoded'),
  (null, '山水画 A3', null, null, 'uncoded'),
  (null, '红色袋子（大）', null, null, 'uncoded'),
  (null, '红色袋子（中）', null, null, 'uncoded'),
  (null, '登记单', null, null, 'uncoded'),
  (null, '护身卡', null, null, 'uncoded'),
  (null, '米袋', null, null, 'uncoded');

-- ---------- 7. SEED: OPENING BALANCES into 总会仓库 (UNVERIFIED — from "As on 2/03/2026") ----------

insert into public.inventory_movements (item_id, movement_type, to_location_id, qty, note, moved_at)
select i.id, 'opening',
       (select id from public.inventory_locations where kind = 'hq_warehouse'),
       v.qty,
       'Seed from 仓库书籍 RECORD.xlsx 仓库记录 As-on-2/03/2026 — UNVERIFIED, correct via stock-take',
       date '2026-03-02'
from (values
  ('S001B0201', 280),
  ('S001B0301', 1378),
  ('S001B0801', 6430),
  ('S001B0802', 5630),
  ('S002B0301', 4966),
  ('S003B0102', 8810),
  ('S006B0101', 740),
  ('S006B0201', 3260),
  ('S007B0101', 15636),
  ('S010B0201', 7320),
  ('S010B0301', 2499),
  ('S011B0104', 2062),
  ('S011B0201', 508),
  ('S011B0301', 2332),
  ('S012B0101', 1220),
  ('S012B0103', 2371),
  ('S012B0105', 1243),
  ('S012B0106', 3306),
  ('S012B0107', 6046),
  ('S012B0108', 3311),
  ('S012B0109', 1281),
  ('S012B0110', 1736),
  ('S012B0111', 5948),
  ('S012B0112', 1530),
  ('S012B0301', 2690),
  ('S012B0302', 3124),
  ('S012B0502', 254),
  ('S012B0601', 280),
  ('S012B0602', 391),
  ('S012B0603', 422),
  ('S012B0604', 469),
  ('S101B0201', 8186),
  ('S101B0204', 1673),
  ('S101B0205', 6479),
  ('S101B0206', 6142),
  ('S101B0402', 4822),
  ('S101B0403', 8720),
  ('S101B0501', 2605),
  ('S101B0502', 3010),
  ('S201B0201', 7871),
  ('S201B0302', 1500),
  ('S201B0501', 177),
  ('S201B0601', 1200),
  ('S301P0102', 3733),
  ('S301P0103', 3300),
  ('S401P0101', 416000),
  ('S401P0202', 41497),
  ('S401P0302', 11244),
  ('S401P0401', 54825),
  ('S401P0501', 57400),
  ('S401P0602', 18500),
  ('S401P0701', 500),
  ('S401P0801', 10672),
  ('S401P0802', 3800),
  ('S401P0803', 4100),
  ('S401P0804', 5651),
  ('S401P0805', 3500),
  ('S501P0201', 4875),
  ('S501P0203', 250),
  ('S501P0205', 38685),
  ('S501P0207', 2152),
  ('S501P0208', 4748),
  ('S501P0401', 100),
  ('S501P0601', 6900),
  ('S501P0602', 2900),
  ('S901Q0201', 1767)
) as v(stock_id, qty)
join public.inventory_items i on i.stock_id = v.stock_id;

insert into public.inventory_movements (item_id, movement_type, to_location_id, qty, note, moved_at)
select i.id, 'opening',
       (select id from public.inventory_locations where kind = 'hq_warehouse'),
       v.qty,
       'Seed from 仓库书籍 RECORD.xlsx 仓库记录 As-on-2/03/2026 — UNVERIFIED, correct via stock-take',
       date '2026-03-02'
from (values
  ('宣传书- COMIC 书', 909),
  ('新漫画 《今天把心洗一洗》', 3300),
  ('感恩sticker (大张)', 149940),
  ('A5 红信封  (一叠）', 99),
  ('纸信封', 2057),
  ('红信封  + A3 红信封  (一叠）', 40),
  ('念佛机', 2240),
  ('红色袋子（大）', 100),
  ('红色袋子（中）', 71),
  ('护身卡', 1379)
) as v(name_cn, qty)
join public.inventory_items i on i.name_cn = v.name_cn and i.stock_id is null;

-- ---------- VERIFY (read-only; run after apply) ----------
-- select count(*) from inventory_items;                                   -- expect 239 (220 coded + 19 uncoded)
-- select count(*) from inventory_locations;                               -- expect 1 + active centres
-- select count(*) from inventory_movements where movement_type='opening'; -- expect 76 (66 coded + 10 uncoded)
-- select qty from inventory_balances b join inventory_items i on i.id=b.item_id
--   where i.stock_id='S001B0301' and b.location_kind='hq_warehouse';      -- expect 1378 (天地人)
-- select sum(qty) from inventory_balances where location_kind='hq_warehouse';
-- select * from role_grants where module='inventory';                     -- 3 rows
