# A2 — Module-permission layer: verification & probe plan

Verification steps for `migrations/013_erp_permission_layer.sql`. Run **PREFLIGHT** in the
Supabase SQL Editor **before** applying 013; if any result differs from the stated
expectation, **STOP and report** (something already diverged from the baseline). Run
**VERIFY** immediately after applying. The **A6 probe plan** is the runtime cross-wing
check to run once test accounts exist.

> ⚠️ **Seed-count reconciliation:** the A2 brief's VERIFY step said "17 seeded rows", but
> the enumerated seed in the brief (and in `013` section e) is **16 rows** (admin 7 +
> erp_admin 5 + volunteer 1 + committee 3 = 16). This doc uses **16** to match the actual
> seed. If Ken intended a 17th grant, name it and it'll be added.

---

## PREFLIGHT — run BEFORE applying 013 (expect the pre-013 baseline)

```sql
-- (1) care-table policies: expect EXACTLY the three "volunteers can read …" USING(true)
select polname, polcmd, polroles::regrole[], pg_get_expr(polqual, polrelid)
  from pg_policy
 where polrelid in ('public.contacts'::regclass,
                    'public.conversations'::regclass,
                    'public.messages'::regclass);

-- (2) volunteers role CHECK: expect the original 2-value check
select pg_get_constraintdef(oid) from pg_constraint
 where conrelid = 'public.volunteers'::regclass and contype = 'c';

-- (3) role_grants must not exist yet
select to_regclass('public.role_grants');
```

**Expected PREFLIGHT results — STOP if different:**

| Query | Expectation |
|---|---|
| (1) | **Exactly 3 rows**, one per table: `polname` = `volunteers can read contacts` / `… conversations` / `… messages`; `polcmd` = `r` (SELECT); `polroles` = `{authenticated}`; `pg_get_expr(polqual…)` = `true`. **No other policies** on these tables (no INSERT/UPDATE/DELETE). |
| (2) | A single CHECK equivalent to `CHECK ((role = ANY (ARRAY['admin'::text, 'volunteer'::text])))`. (Name is auto-generated — the *rule* is what matters.) |
| (3) | `null` (role_grants does not exist). |

If (1) shows extra policies, (2) shows an already-widened check, or (3) is non-null → **the DB
already diverges from the baseline; STOP and reconcile before applying 013.**

---

## VERIFY — run AFTER applying 013 (expect the new state)

```sql
-- (1) care-table policies now enforce the care module grant
select polname, polcmd, polroles::regrole[], pg_get_expr(polqual, polrelid)
  from pg_policy
 where polrelid in ('public.contacts'::regclass,
                    'public.conversations'::regclass,
                    'public.messages'::regclass);

-- (2) the seeded grant matrix
select role, module, access from public.role_grants order by role, module;

-- (3) definer fn returns false with no auth.uid() (SQL Editor runs as a superuser,
--     not an authenticated end-user, so auth.uid() is NULL)
select public.has_module_access('care','view');

-- (4) volunteers role CHECK is now the widened, named constraint
select conname, pg_get_constraintdef(oid) from pg_constraint
 where conrelid = 'public.volunteers'::regclass and contype = 'c';
```

**Expected VERIFY results:**

| Query | Expectation |
|---|---|
| (1) | **Exactly 3 rows**: `polname` = `care module can read contacts` / `… conversations` / `… messages`; `polcmd` = `r`; `polroles` = `{authenticated}`; `pg_get_expr(polqual…)` = `has_module_access('care'::text, 'view'::text)`. Still no write policies. |
| (2) | **Exactly 16 rows** (below). |
| (3) | `false` (no `auth.uid()` in the editor session ⇒ no volunteer row ⇒ coalesce to false). |
| (4) | `conname` = `volunteers_role_check`; def equivalent to `CHECK ((role = ANY (ARRAY['admin','volunteer','erp_admin','committee'])))`. |

**Expected 16 grant rows (query 2), ordered by role, module:**

| role | module | access |
|---|---|---|
| admin | audit | view |
| admin | care | admin |
| admin | duty | admin |
| admin | events | admin |
| admin | finance | admin |
| admin | members | admin |
| admin | settings | admin |
| committee | events | view |
| committee | finance | view |
| committee | members | summary |
| erp_admin | duty | admin |
| erp_admin | events | admin |
| erp_admin | finance | admin |
| erp_admin | members | admin |
| erp_admin | settings | edit |
| volunteer | care | edit |

Spot-checks worth eyeballing: `erp_admin` has **no `care` row and no `audit` row**; `volunteer`
has **only** `care`; `admin` is the only role with an `audit` grant.

**Optional deeper check** — confirm the definer fn actually discriminates by impersonating a
role's grant lookup (read-only, superuser context):
```sql
-- does role X clear the bar for (module, min)? (mirrors has_module_access's core compare)
select r.role,
       coalesce(public.access_rank(g.access) >= public.access_rank('view'), false) as care_view_ok
  from (values ('admin'),('volunteer'),('erp_admin'),('committee')) r(role)
  left join public.role_grants g on g.role = r.role and g.module = 'care';
-- expect: admin=true, volunteer=true, erp_admin=false, committee=false
```

---

## A6 PROBE PLAN — runtime cross-wing enforcement (run once test accounts exist)

Goal: prove that **both doors are closed** for a non-care role — the **PostgREST REST API**
(RLS) and the **app routes** (`requireModuleAccess`). Create one active test account per role
in `volunteers` (each linked to a real `auth.users` login), then:

### Part A — PostgREST / RLS (the direct-DB door)
A denied SELECT under RLS returns **HTTP 200 with an empty array** (RLS filters rows; it does
not 403). So a care read must return **rows** for a care role and **`[]`** for a non-care role.

Obtain a per-role user JWT (do **not** paste secrets into this doc). Either sign in as each test
user and copy the `access_token`, or mint one:
```bash
# Sign in as a role's test user → grab .access_token (repeat per role)
curl -s "https://$PROJECT_REF.supabase.co/auth/v1/token?grant_type=password" \
  -H "apikey: $SUPABASE_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{"email":"'"$ROLE_TEST_EMAIL"'","password":"'"$ROLE_TEST_PASSWORD"'"}'
# → export USER_JWT=<access_token from the response>
```

Then hit the care tables with that JWT + the anon apikey:
```bash
# Template — run once per role's USER_JWT, and once per table (contacts|conversations|messages)
curl -s -o /dev/null -w "%{http_code} " \
  "https://$PROJECT_REF.supabase.co/rest/v1/contacts?select=id&limit=1" \
  -H "apikey: $SUPABASE_ANON_KEY" \
  -H "Authorization: Bearer $USER_JWT"
curl -s \
  "https://$PROJECT_REF.supabase.co/rest/v1/conversations?select=id&limit=5" \
  -H "apikey: $SUPABASE_ANON_KEY" \
  -H "Authorization: Bearer $USER_JWT"
```

**Expected (per role), for contacts / conversations / messages:**

| Role (JWT) | HTTP | Body |
|---|---|---|
| `volunteer` | 200 | non-empty array (rows visible — `care:edit` ≥ `view`) |
| `admin` | 200 | non-empty array (`care:admin` ≥ `view`) |
| `erp_admin` | 200 | **`[]`** — zero rows (no care grant) ✅ door closed |
| `committee` | 200 | **`[]`** — zero rows (no care grant) ✅ door closed |
| no `Authorization` (anon only) | 200 | **`[]`** — zero rows (not `authenticated`) |

The critical assertions: **`erp_admin` and `committee` must get `[]` from all three care tables**,
while **`volunteer` still gets rows**.

### Part B — App routes (the server-route door)
App routes authenticate via the Supabase **session cookie**, not a Bearer token, so probe these
while logged into the dashboard as each test user (browser devtools / copy the request), or with
the session cookie attached. `requireModuleAccess('care','view'|'edit')` gates them.

```bash
# With the logged-in session cookie for the role under test:
curl -s -o /dev/null -w "%{http_code}\n" \
  "$APP_ORIGIN/api/dashboard/conversations" \
  -H "Cookie: $ROLE_SESSION_COOKIE"
```

**Expected status per role:**

| Route | volunteer | admin | erp_admin | committee | no session |
|---|---|---|---|---|---|
| `GET /api/dashboard/conversations` (care:view) | 200 | 200 | **403** | **403** | 401 |
| `GET /api/dashboard/conversations/[id]` (care:view) | 200 | 200 | **403** | **403** | 401 |
| `POST /api/dashboard/conversations/[id]/read` (care:view) | 200 | 200 | **403** | **403** | 401 |
| `PATCH /api/dashboard/contacts/[id]` (care:edit) | 200 | 200 | **403** | **403** | 401 |
| `POST …/[id]/reply` · `…/takeover` · `…/handback` (care:edit) | 200* | 200* | **403** | **403** | 401 |
| `GET /api/dashboard/reports` (care:view **+ admin**) | **403** (仅限管理员) | 200 | **403** | **403** | 401 |

\* subject to each route's own business rules (assignee/status checks) **after** the gate — those
are unchanged by A2.

Error-body shape from the gate: `{"error":"Unauthorized"}` for 401, `{"error":"Forbidden"}` for 403.

### Not touched by A2 (must keep working for ALL roles / their existing gates)
- `GET /api/dashboard/me`, `POST /api/dashboard/me/change-password` — must succeed for **every**
  active role incl. `erp_admin` / `committee` (they still need to see who they are and rotate a
  first-login password). No `requireModuleAccess` added.
- `/api/dashboard/volunteers/*` — stays **admin-only** via its own `role !== 'admin'` check (until A6).
- `/api/chat/*`, `/api/cron/*`, `/api/webhooks/*` — no session auth (public / bearer / webhook); different gates, untouched.

---

## Notes on the 401 vs 403 semantics (changed by A2, intentionally)
Before A2, care routes returned **403 "Not an active volunteer"** when a session existed but no
active `volunteers` row. Under `requireModuleAccess`, **no active volunteer ⇒ 401** and **active
account without the module grant ⇒ 403 "Forbidden"**. This is the correct model for two wings: an
`erp_admin` is a real, active account (so not 401) that simply lacks care access (403). The JSON
envelope (`{ "error": string }`) and the 401/403 status codes match the existing route style.
