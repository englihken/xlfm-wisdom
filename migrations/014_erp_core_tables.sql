-- 014_erp_core_tables.sql
-- =====================================================================================
-- PURPOSE (ERP task A3 — core ERP wing tables).
--   Creates the ERP membership schema: real reference tables (centres, teams), the
--   import staging pair (import_batches + legacy_rows — raw rows survive verbatim
--   forever), the members table (one row per 信众/义工) with its association tables
--   (member_teams, member_skills), and an INSERT-only audit_log skeleton.
--
--   Everything is ADDITIVE and independent of the care wing. The care wing keeps
--   using the TS constant XLFM_CENTERS (src/lib/xlfm-centers.ts) for now; centres
--   here is seeded FROM that constant (+ one overseas row) so a later cleanup can
--   link volunteers.center → centres. Nothing references these tables yet.
--
--   RLS is enabled on every new table with SELECT-only policies gated on the module
--   grants from 013 (members/audit). Writes stay service-role-only (NO write
--   policies), exactly like the care wing. committee's 'summary' rank is below
--   'view', so committee gets no row-level reads here — their aggregate/summary
--   views arrive later as SECURITY DEFINER views (Phase D/F).
--
-- APPLY MANUALLY: paste into the Supabase SQL Editor (this repo applies migrations by
--   hand). Run docs/erp/02-a3-verification.md PREFLIGHT first; if it does not match
--   the stated expectation, STOP and reconcile before applying.
--
-- ROLLBACK (manual — safe, nothing external references these yet). Dropping a table
--   drops its RLS policies automatically. Drop in reverse dependency order:
--     drop table if exists public.audit_log;
--     drop table if exists public.member_skills;
--     drop table if exists public.member_teams;
--     drop table if exists public.legacy_rows;
--     drop table if exists public.members;
--     drop table if exists public.import_batches;
--     drop table if exists public.teams;
--     drop table if exists public.centres;
-- =====================================================================================


-- ── (a) centres — the ERP's real centres table (seeded from XLFM_CENTERS) ─────────────
create table public.centres (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,               -- 'IPOH', 'ULU TIRAM', 'HQ' … uppercase, legacy-Excel compatible
  name_cn text not null,
  name_en text not null,
  state text not null,
  aliases text[] not null default '{}',    -- legacy Excel codes that map here
  is_active boolean not null default true,
  sort int not null default 0
);

-- Seed: one row per centre in src/lib/xlfm-centers.ts (code = UPPERCASE of the English
-- part of the bilingual label), PLUS one overseas row (BRUNEI) not in the constant.
-- 36 centres seeded = 35 from XLFM_CENTERS + 1 BRUNEI.
insert into public.centres (code, name_cn, name_en, state, aliases, sort) values
  -- 吉隆坡
  ('HQ',               '总会',       'HQ',               '吉隆坡', '{}', 1),
  ('CHERAS',           '蕉赖',       'Cheras',           '吉隆坡', '{}', 2),
  -- 雪兰莪
  ('PUCHONG',          '蒲种',       'Puchong',          '雪兰莪', '{}', 3),
  ('PETALING JAYA',    '八打灵再也', 'Petaling Jaya',    '雪兰莪', '{}', 4),
  ('KLANG',            '巴生',       'Klang',            '雪兰莪', '{}', 5),
  ('KUALA SELANGOR',   '瓜拉雪兰莪', 'Kuala Selangor',   '雪兰莪', '{K.SELANGOR}', 6),
  -- 柔佛
  ('KULAI',            '古来',       'Kulai',            '柔佛',   '{}', 7),
  ('SKUDAI',           '士姑来',     'Skudai',           '柔佛',   '{}', 8),
  ('ULU TIRAM',        '乌鲁地南',   'Ulu Tiram',        '柔佛',   '{}', 9),
  ('BATU PAHAT',       '峇株巴辖',   'Batu Pahat',       '柔佛',   '{}', 10),
  ('YONG PENG',        '永平',       'Yong Peng',        '柔佛',   '{}', 11),
  ('MUAR',             '麻坡',       'Muar',             '柔佛',   '{}', 12),
  ('SEGAMAT',          '昔加末',     'Segamat',          '柔佛',   '{}', 13),
  ('KLUANG',           '居銮',       'Kluang',           '柔佛',   '{}', 14),
  -- 东海岸
  ('KUANTAN',          '关丹',       'Kuantan',          '东海岸', '{}', 15),
  ('JERANTUT',         '而连突',     'Jerantut',         '东海岸', '{}', 16),
  ('KUALA TERENGGANU', '瓜拉登嘉楼', 'Kuala Terengganu', '东海岸', '{}', 17),
  ('KOTA BHARU',       '哥打巴鲁',   'Kota Bharu',       '东海岸', '{}', 18),
  -- 马六甲
  ('MELAKA',           '马六甲',     'Melaka',           '马六甲', '{}', 19),
  -- 吉打
  ('ALOR SETAR',       '亚罗士打',   'Alor Setar',       '吉打',   '{}', 20),
  ('SUNGAI PETANI',    '双溪大年',   'Sungai Petani',    '吉打',   '{}', 21),
  -- 森美兰
  ('SEREMBAN',         '芙蓉',       'Seremban',         '森美兰', '{}', 22),
  -- 霹雳
  ('IPOH',             '怡保',       'Ipoh',             '霹雳',   '{}', 23),
  ('TELUK INTAN',      '安顺',       'Teluk Intan',      '霹雳',   '{}', 24),
  ('SITIAWAN',         '实兆远',     'Sitiawan',         '霹雳',   '{}', 25),
  ('TAIPING',          '太平',       'Taiping',          '霹雳',   '{}', 26),
  -- 沙巴
  ('KOTA KINABALU',    '亚庇',       'Kota Kinabalu',    '沙巴',   '{}', 27),
  ('SANDAKAN',         '山打根',     'Sandakan',         '沙巴',   '{}', 28),
  ('TAWAU',            '斗湖',       'Tawau',            '沙巴',   '{}', 29),
  -- 砂拉越
  ('KUCHING',          '古晋',       'Kuching',          '砂拉越', '{}', 30),
  ('SIBU',             '诗巫',       'Sibu',             '砂拉越', '{}', 31),
  ('MIRI',             '美里',       'Miri',             '砂拉越', '{}', 32),
  -- 槟城
  ('SIMPANG AMPAT',    '威南',       'Simpang Ampat',    '槟城',   '{}', 33),
  ('BAYAN LEPAS',      '槟岛',       'Bayan Lepas',      '槟城',   '{}', 34),
  ('BUTTERWORTH',      '北海',       'Butterworth',      '槟城',   '{}', 35),
  -- overseas (not in XLFM_CENTERS; 2019 data has overseas practitioners — Ken may deactivate)
  ('BRUNEI',           '汶莱',       'Brunei',           '汶莱 Brunei', '{}', 999);


-- ── (b) teams — editable reference table ─────────────────────────────────────────────
create table public.teams (
  id uuid primary key default gen_random_uuid(),
  name_cn text not null unique,
  name_en text,
  slug text not null unique,
  is_active boolean not null default true,
  sort int not null default 0
);

insert into public.teams (name_cn, name_en, slug, sort) values
  ('交通', 'Transport',   'transport',   1),
  ('膳食', 'Meals',       'meals',       2),
  ('场务', 'Venue',       'venue',       3),
  ('宣传', 'Publicity',   'publicity',   4),
  ('物流', 'Logistics',   'logistics',   5),
  ('佛台', 'Altar',       'altar',       6),
  ('仓库', 'Warehouse',   'warehouse',   7),
  ('摄影', 'Photography', 'photography', 8),
  ('技术', 'Tech',        'tech',        9),
  ('通讯', 'Comms',       'comms',       10);


-- ── (c) import_batches + legacy_rows — staging (raw rows survive verbatim forever) ────
create table public.import_batches (
  id uuid primary key default gen_random_uuid(),
  source_file text not null,
  sheet_name text,
  event_hint text,                         -- e.g. '2019-10 法会'
  row_count int,
  stats jsonb,
  created_by uuid references public.volunteers(id),
  created_at timestamptz not null default now()
);

create table public.legacy_rows (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.import_batches(id) on delete cascade,
  row_no int not null,
  raw jsonb not null,
  member_id uuid,                          -- FK added after members exists (see d)
  match_method text check (match_method in ('phone','name_centre','created_new','skipped','error')),
  issues text[] not null default '{}'
);


-- ── (d) members — one row per person (信众/义工) ─────────────────────────────────────
create table public.members (
  id uuid primary key default gen_random_uuid(),
  gyt_centre_id uuid references public.centres(id),
  member_type text not null default 'member' check (member_type in ('member','volunteer')),
  name_cn text,
  name_en text,
  gender text check (gender in ('M','F')),
  dob date,                                -- NULL allowed; age is always derived, never stored
  phone text,                              -- normalized 60…; partial UNIQUE index below
  email text,
  address text,
  birthplace text,
  religion text,
  marital_status text,
  occupation text,
  languages text[],
  disciple boolean,                        -- yes/no; NULL = unknown (boolean, not enum)
  disciple_no text,
  baishi_year int,
  baishi_place text,
  start_practice_year int,
  full_veg boolean,
  veg_since int,
  snoring boolean,
  shirt_size text check (shirt_size in ('XS','S','M','L','XL','XXL','3XL','4XL')),
  emergency_contact_name text,
  emergency_contact_phone text,
  referrer_name text,
  referrer_phone text,
  referrer_member_id uuid references public.members(id),
  photo_path text,                         -- for the future; photos currently skipped
  photo_source_url text,                   -- original Formsite link, provenance
  status text not null default 'active' check (status in ('active','inactive')),  -- deactivate-not-delete
  notes text,
  import_batch_id uuid references public.import_batches(id),
  created_at timestamptz not null default now(),
  created_by uuid references public.volunteers(id),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.volunteers(id),
  constraint members_name_present check (name_cn is not null or name_en is not null)
);

create unique index members_phone_unique on public.members(phone) where phone is not null;
create index members_gyt_centre_idx on public.members(gyt_centre_id);
create index members_name_cn_idx on public.members(name_cn);

-- Now that members exists, wire the staging FK from legacy_rows.member_id.
alter table public.legacy_rows
  add constraint legacy_rows_member_fk
  foreign key (member_id) references public.members(id);


-- ── (e) member_teams + member_skills ─────────────────────────────────────────────────
create table public.member_teams (
  member_id uuid not null references public.members(id) on delete cascade,
  team_id uuid not null references public.teams(id),
  role text not null default 'member' check (role in ('lead','member')),
  is_current boolean not null default true,
  since date,
  notes text,
  primary key (member_id, team_id)
);

create table public.member_skills (
  member_id uuid not null references public.members(id) on delete cascade,
  skill text not null,                     -- open tags: 'lorry_license', 'carpenter', …
  source text,                             -- e.g. 'import:2019交通组'
  primary key (member_id, skill)
);


-- ── (f) audit_log — INSERT-only skeleton (writers wired app-side in A4) ───────────────
create table public.audit_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  actor_id uuid,                           -- volunteers.id of who did it (app supplies)
  actor_email text,
  module text not null,
  action text not null,                    -- 'create' | 'update' | 'deactivate' | 'import' …
  table_name text not null,
  record_id text,
  before jsonb,
  after jsonb
);


-- ── (g) RLS — enable on all new tables; SELECT-only policies gated by module grants ──
-- Writes stay service-role-only: no INSERT/UPDATE/DELETE policies anywhere.
alter table public.centres        enable row level security;
alter table public.teams          enable row level security;
alter table public.members        enable row level security;
alter table public.member_teams   enable row level security;
alter table public.member_skills  enable row level security;
alter table public.import_batches enable row level security;
alter table public.legacy_rows    enable row level security;
alter table public.audit_log      enable row level security;

-- members module (view) gates the membership tables …
create policy "members module can read centres" on public.centres
  for select to authenticated using (public.has_module_access('members','view'));
create policy "members module can read teams" on public.teams
  for select to authenticated using (public.has_module_access('members','view'));
create policy "members module can read members" on public.members
  for select to authenticated using (public.has_module_access('members','view'));
create policy "members module can read member_teams" on public.member_teams
  for select to authenticated using (public.has_module_access('members','view'));
create policy "members module can read member_skills" on public.member_skills
  for select to authenticated using (public.has_module_access('members','view'));
create policy "members module can read import_batches" on public.import_batches
  for select to authenticated using (public.has_module_access('members','view'));
create policy "members module can read legacy_rows" on public.legacy_rows
  for select to authenticated using (public.has_module_access('members','view'));

-- … and the audit module (view) gates the audit trail.
create policy "audit module can read audit_log" on public.audit_log
  for select to authenticated using (public.has_module_access('audit','view'));
