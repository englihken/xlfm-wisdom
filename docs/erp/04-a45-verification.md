# A4.5 — platform frame + hub + centre scope: verification

Covers `migrations/015_centre_scope_and_modules.sql` (DB) and the app changes (neutral
platform frame, `/dashboard/home` hub, `visibleModules` door logic, centre-scope
dimension). Run **PREFLIGHT** in the Supabase SQL Editor **before** applying 015 (each
statement alone; STOP on any deviation), **VERIFY** after applying, then the **App
matrix** after deploy.

> **Intended behavior change:** Ken (admin, multi-door) now lands on the **hub**
> (`/dashboard/home`), one click from the inbox — not straight into the inbox as before.
> Care volunteers (single door) are **unchanged**: they still land directly on the inbox.

---

## PREFLIGHT — before applying 015 (STOP on deviation)

```sql
-- (1) current role_grants module CHECK — expect the 7-key vocabulary from 013
select pg_get_constraintdef(oid) from pg_constraint
 where conrelid = 'public.role_grants'::regclass and contype = 'c'
   and pg_get_constraintdef(oid) ilike '%module%';

-- (2) volunteers has NO centre_id / scope yet — expect 0 rows
select column_name from information_schema.columns
 where table_schema = 'public' and table_name = 'volunteers'
   and column_name in ('centre_id', 'scope');

-- (3) centre_scope_allows does not exist yet — expect null
select to_regprocedure('public.centre_scope_allows(uuid)');

-- (4) the 5 member-data policies exist by exact name (module-only, from 014)
select polname, polrelid::regclass from pg_policy
 where polname in (
   'members module can read members',
   'members module can read member_teams',
   'members module can read member_skills',
   'members module can read legacy_rows',
   'members module can read import_batches'
 ) order by polname;
```

**Expect — STOP if different:**
| # | Expectation |
|---|---|
| (1) | `CHECK ((module = ANY (ARRAY['care','members','events','finance','duty','settings','audit'])))` (7 keys). |
| (2) | **0 rows** (columns absent). |
| (3) | `null`. |
| (4) | **Exactly these 5** rows; each `pg_get_expr(polqual…)` = `has_module_access('members'::text, 'view'::text)` (verify with the query in §VERIFY(5) if unsure). |

---

## VERIFY — after applying 015

```sql
-- (1) module CHECK now 9 keys, named role_grants_module_check
select conname, pg_get_constraintdef(oid) from pg_constraint
 where conrelid = 'public.role_grants'::regclass and contype = 'c'
   and pg_get_constraintdef(oid) ilike '%module%';

-- (2) volunteers columns exist with the right types/defaults
select column_name, data_type, column_default, is_nullable
 from information_schema.columns
 where table_schema = 'public' and table_name = 'volunteers'
   and column_name in ('centre_id', 'scope') order by column_name;

-- (3) scope distribution
select scope, count(*) from public.volunteers group by scope order by scope;

-- (4) the definer fn returns false with no editor session
select public.centre_scope_allows(null);

-- (5) the 5 policies show the composed quals
select polname, pg_get_expr(polqual, polrelid) as using_expr from pg_policy
 where polname in (
   'members module can read members',
   'members module can read member_teams',
   'members module can read member_skills',
   'members module can read legacy_rows',
   'members module can read import_batches'
 ) order by polname;
```

**Expect:**
| # | Expectation |
|---|---|
| (1) | `conname = role_grants_module_check`; def lists **9** keys incl. `inventory` and `reports`. |
| (2) | `centre_id` = uuid, nullable, no default; `scope` = text, `NOT NULL`, default `'own_center'`. |
| (3) | `all_centers` = (# of admin + erp_admin + committee); `own_center` = everyone else (the care volunteers). |
| (4) | `false` (SQL Editor runs as superuser — no `auth.uid()`). |
| (5) | quals (verbatim intent):<br>• members → `has_module_access('members','view') AND centre_scope_allows(gyt_centre_id)`<br>• member_teams / member_skills → `… AND (EXISTS ( … centre_scope_allows(m.gyt_centre_id)))`<br>• legacy_rows → `… AND (centre_scope_allows(NULL) OR EXISTS( … ))`<br>• import_batches → `… AND centre_scope_allows(NULL)` |

**Note:** for today's roles this changes nothing — admin/erp_admin/committee are `all_centers`
(so `centre_scope_allows` is always true), and `volunteer` holds no `members` grant. The scope
dimension is dormant until Phase D centre roles exist.

---

## App matrix — after deploy

### admin (Ken — multi-door)
- Log in → `/dashboard` → **redirected to `/dashboard/home`** (the hub).
- Header shows **🪷 心灵法门数字平台** (platform brand, no module title).
- The hub is a **My Day (今日概览页), NOT a module tile grid** — the rail is the sole module launcher. Blocks (all grant-gated; admin holds care+members+audit so all appear):
  1. Greeting **吉祥，{名字} 🙏** + today's date (Asia/Kuala_Lumpur, zh-CN weekday).
  2. **今日概览** stat strip: **未读对话**, **我接手的未读**, **会员总数**.
  3. **我的事项** — up to 3 of my assigned conversations (unread first; name/preview/time), each → `/dashboard`. Empty → **今日无待办 🙏**.
  4. **最近会员动态** — 3 most-recently created/updated members (name, centre code, relative time) → their profiles.
  5. **系统动态** — last 5 `audit_log` rows as human one-liners (actor 动作了 表 (ref)) — **audit≥view only** (admin today). No raw JSON.
  6. **快捷操作** — 去收件箱 (care≥view) · 会员列表 (members≥view) · ＋新增会员 (members≥edit).
- **No module tile grid, no greyed/locked blocks.** On any module page, the nav rail shows **⌂ 主页 first**, then the doors.
- `未读对话` matches the inbox's unread dot count (shared predicate).

### care volunteer (single door)
- Log in → **lands directly on the inbox** (`/dashboard`) — **no hub flash**, no redirect hop.
- Header shows **🪷 心灵法门数字平台 / 人文关怀 · Care**.
- Nav rail shows **NO ⌂ 主页** item (single-door accounts never see the hub link) and no 会员/报表/设置.
- Visiting `/dashboard/home` directly → **bounced back to the inbox** (the hub never renders for them, so they never see My Day).
- **Zero greyed/locked blocks or tiles** anywhere. Inbox list, open conversation, takeover + reply flow all **unchanged**.

### A note on My-Day block gating
Each hub block is present **only** when the caller holds its grant — the stats endpoint returns
`myConversations`/`recentMembers`/`recentAudit` fields **only** for held grants, and the page
renders a block only when its field is present. A future members-only role (erp_admin, A6) would,
if it ever reached a multi-door hub, see only members blocks + quick actions — never a care or
audit block. (Today erp_admin is single-door → members, so it doesn't see the hub at all.)

### erp_admin (single members door — exists at A6)
- Log in → `/dashboard` → redirected to `/dashboard/members` (mods == ['members']). No hub. (Deferred to A6 — account doesn't exist yet.)

### REST probe (RLS unchanged for today's roles)
```bash
# admin JWT — members SELECT still returns rows (all_centers scope)
curl -s "https://$PROJECT_REF.supabase.co/rest/v1/members?select=id&limit=3" \
  -H "apikey: $SUPABASE_ANON_KEY" -H "Authorization: Bearer $ADMIN_USER_JWT"
# expect a non-empty array (has_module_access('members','view') AND centre_scope_allows(all_centers→true))
```
Full per-role RLS scope probing (own_center centre roles) lands in **Phase D**, when centre-scoped
roles are created; today every ERP role is `all_centers` so behavior is identical to A4.

---

## Door-visibility invariant (single source of truth)
Every door decision — nav rail items AND hub tiles — flows through **`visibleModules(me)`** in
`src/lib/access.ts`. There is no second place that decides which modules a caller sees. A door is
emitted **only** if the caller can enter it; the hub/nav never render greyed, locked, disabled, or
teaser tiles for modules the caller lacks (privacy rule).
