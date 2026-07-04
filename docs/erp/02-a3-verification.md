# A3 — ERP core tables: verification

Verification for `migrations/014_erp_core_tables.sql`. Run **PREFLIGHT** in the Supabase
SQL Editor **before** applying 014; run each statement alone and STOP on any deviation
(the DB has diverged from the expected pre-014 state). Run **VERIFY** immediately after
applying. The **legacy-Excel centre-code mapping** at the end lets the A5 import be
eyeball-checked.

---

## PREFLIGHT — run BEFORE applying 014 (each statement alone; STOP on deviation)

```sql
-- (1) none of the 8 ERP tables exist yet → expect 8 × NULL
select to_regclass(t) from unnest(array[
  'public.centres','public.teams','public.members','public.member_teams',
  'public.member_skills','public.import_batches','public.legacy_rows','public.audit_log'
]) t;

-- (2) 013 is intact → expect 16
select count(*) from public.role_grants;

-- (3) definer fn works, no editor session → expect false
select public.has_module_access('members','view');
```

**Expected — STOP if different:**

| # | Expectation |
|---|---|
| (1) | 8 rows, **all `NULL`** (no ERP table exists yet). If any is non-null, that table already exists — STOP. |
| (2) | `16` (the 013 seed is present and unchanged). Any other number → STOP. |
| (3) | `false` (SQL Editor runs as a superuser with no `auth.uid()`; the definer fn returns false). |

---

## VERIFY — run AFTER applying 014

```sql
-- (1) all 8 tables now exist → expect 8 real regclass names, no NULLs
select to_regclass(t) from unnest(array[
  'public.centres','public.teams','public.members','public.member_teams',
  'public.member_skills','public.import_batches','public.legacy_rows','public.audit_log'
]) t;

-- (2) centre count → expect 36 (35 from XLFM_CENTERS + 1 BRUNEI, per 014's comment)
select count(*) from public.centres;

-- (3) the special centre rows (alias + the two called-out codes)
select code, aliases from public.centres
 where aliases <> '{}' or code in ('HQ','BRUNEI','KUALA SELANGOR')
 order by code;

-- (4) the 10 team seeds in order
select name_cn, slug from public.teams order by sort;

-- (5) RLS is on for every new table → expect rowsecurity = true for all 8
select tablename, rowsecurity from pg_tables
 where schemaname = 'public'
   and tablename in ('centres','teams','members','member_teams','member_skills',
                     'import_batches','legacy_rows','audit_log')
 order by tablename;

-- (6) each table's SELECT policy carries the correct module gate
select polname, polrelid::regclass, pg_get_expr(polqual, polrelid)
  from pg_policy
 where polrelid::regclass::text in ('centres','teams','members','member_teams',
       'member_skills','import_batches','legacy_rows','audit_log')
 order by polrelid::regclass::text;
```

**Expected:**

| # | Expectation |
|---|---|
| (1) | 8 rows, each a real name (`centres`, `teams`, `members`, `member_teams`, `member_skills`, `import_batches`, `legacy_rows`, `audit_log`) — **no NULLs**. |
| (2) | `36`. |
| (3) | **3 rows**: `HQ` → `{}`, `KUALA SELANGOR` → `{K.SELANGOR}`, `BRUNEI` → `{}`. |
| (4) | 10 rows in this order: 交通/transport, 膳食/meals, 场务/venue, 宣传/publicity, 物流/logistics, 佛台/altar, 仓库/warehouse, 摄影/photography, 技术/tech, 通讯/comms. |
| (5) | `rowsecurity = true` (t) for all 8 tables. |
| (6) | 8 policy rows. The 7 membership tables (`centres`, `teams`, `members`, `member_teams`, `member_skills`, `import_batches`, `legacy_rows`) each show qual `has_module_access('members'::text, 'view'::text)`; `audit_log` shows `has_module_access('audit'::text, 'view'::text)`. Policy names: `members module can read <table>` (×7) and `audit module can read audit_log`. **No write policies** should appear. |

**Optional — confirm no accidental write policies slipped in (expect only the 8 SELECT rows):**
```sql
select polrelid::regclass, polname, polcmd from pg_policy
 where polrelid::regclass::text in ('centres','teams','members','member_teams',
       'member_skills','import_batches','legacy_rows','audit_log')
 order by polrelid::regclass::text;
-- expect polcmd = 'r' (SELECT) for all 8, nothing else.
```

**Optional — module-gate sanity for the new tables (mirrors the RLS predicate per role):**
```sql
select r.role,
       coalesce(public.access_rank(g.access) >= public.access_rank('view'), false) as members_view_ok
  from (values ('admin'),('volunteer'),('erp_admin'),('committee')) r(role)
  left join public.role_grants g on g.role = r.role and g.module = 'members';
-- expect: admin=true, erp_admin=true, committee=false (summary<view), volunteer=false (no members grant)
```
This confirms the intended row-level visibility once real end-user JWTs exist (A6 probe): `admin`
and `erp_admin` can read membership rows; `committee` and `volunteer` get zero rows. `audit_log`
is admin-only (only `admin` holds an `audit` grant).

---

## Legacy-Excel centre-code mapping (for the A5 import eyeball-check)

The 2019 Excel identifies a person's centre by an English/short code. `centres.code` was derived
as the **UPPERCASE English part** of each `XLFM_CENTERS` label, so the A5 import should resolve a
raw Excel code by matching **case-insensitively against `code` first, then `aliases`**, and flag
anything unmatched for manual review rather than guessing.

Special cases to watch (the rest map 1:1 by uppercased English name):

| Excel code (raw) | → `centres.code` | How it resolves | Note |
|---|---|---|---|
| `K.SELANGOR` / `K. SELANGOR` | `KUALA SELANGOR` | via **`aliases`** (`{K.SELANGOR}`) | abbreviation in the sheet |
| `BRUNEI` | `BRUNEI` | via the **new overseas row** (not in XLFM_CENTERS) | Ken may deactivate |
| `HQ` / `总会` | `HQ` | direct on `code` | 吉隆坡 总会 |

Full expected direct matches (Excel code == `centres.code`, all uppercase):

| centres.code | 中文 | state |
|---|---|---|
| HQ | 总会 | 吉隆坡 |
| CHERAS | 蕉赖 | 吉隆坡 |
| PUCHONG | 蒲种 | 雪兰莪 |
| PETALING JAYA | 八打灵再也 | 雪兰莪 |
| KLANG | 巴生 | 雪兰莪 |
| KUALA SELANGOR | 瓜拉雪兰莪 | 雪兰莪 (alias `K.SELANGOR`) |
| KULAI | 古来 | 柔佛 |
| SKUDAI | 士姑来 | 柔佛 |
| ULU TIRAM | 乌鲁地南 | 柔佛 |
| BATU PAHAT | 峇株巴辖 | 柔佛 |
| YONG PENG | 永平 | 柔佛 |
| MUAR | 麻坡 | 柔佛 |
| SEGAMAT | 昔加末 | 柔佛 |
| KLUANG | 居銮 | 柔佛 |
| KUANTAN | 关丹 | 东海岸 |
| JERANTUT | 而连突 | 东海岸 |
| KUALA TERENGGANU | 瓜拉登嘉楼 | 东海岸 |
| KOTA BHARU | 哥打巴鲁 | 东海岸 |
| MELAKA | 马六甲 | 马六甲 |
| ALOR SETAR | 亚罗士打 | 吉打 |
| SUNGAI PETANI | 双溪大年 | 吉打 |
| SEREMBAN | 芙蓉 | 森美兰 |
| IPOH | 怡保 | 霹雳 |
| TELUK INTAN | 安顺 | 霹雳 |
| SITIAWAN | 实兆远 | 霹雳 |
| TAIPING | 太平 | 霹雳 |
| KOTA KINABALU | 亚庇 | 沙巴 |
| SANDAKAN | 山打根 | 沙巴 |
| TAWAU | 斗湖 | 沙巴 |
| KUCHING | 古晋 | 砂拉越 |
| SIBU | 诗巫 | 砂拉越 |
| MIRI | 美里 | 砂拉越 |
| SIMPANG AMPAT | 威南 | 槟城 |
| BAYAN LEPAS | 槟岛 | 槟城 |
| BUTTERWORTH | 北海 | 槟城 |
| BRUNEI | 汶莱 | 汶莱 Brunei (new; overseas) |

**A5 guidance:** match raw Excel centre codes case-insensitively (trim + uppercase) against
`centres.code`, then against each element of `centres.aliases`; on no match, record the row with
`legacy_rows.match_method` handling and an `issues` tag rather than inventing a centre. New aliases
discovered during A5 (e.g. other abbreviations, multi-space variants) should be appended to the
relevant `centres.aliases` array, not hardcoded in the importer.
