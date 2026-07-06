# C1 — public login-free registration: schema + API verification (migration 018)

Covers `migrations/018_public_registration.sql` (the public-form gate columns
`events.public_registration_enabled` + `events.public_token`, and the newcomer-dupe
partial index on `registrations`) and the `/api/public/**` anonymous API surface.

Run **PREFLIGHT** in the Supabase SQL Editor **before** applying 018 (each statement
alone; STOP on any deviation) and **VERIFY** after applying.

> **DEPLOY ORDER — apply 018 FIRST, then push the C1 code.** The public routes and the
> staff PATCH read `events.public_registration_enabled` / `public_token`; deploying the
> code first would break the events PATCH (unknown column). Migration → verify → deploy.

---

## PREFLIGHT — before applying 018 (STOP on deviation)

```sql
-- (1) events does NOT yet have the two public columns — expect 0 rows
select column_name from information_schema.columns
 where table_schema='public' and table_name='events'
   and column_name in ('public_registration_enabled','public_token');

-- (2) the newcomer-dupe index does not exist yet — expect 0 rows
select indexname from pg_indexes
 where schemaname='public' and tablename='registrations'
   and indexname='registrations_public_dupe';

-- (3) the events wing is present (016/017 applied) — expect 5 real names, no NULLs
select to_regclass(t) from unnest(array[
  'public.events','public.event_fees','public.event_team_needs',
  'public.registrations','public.event_meal_slots'
]) t;

-- (4) registrations already has the identity columns 018's index depends on — expect 2 rows
select column_name from information_schema.columns
 where table_schema='public' and table_name='registrations'
   and column_name in ('applicant_phone','member_id');
```

**Expect — STOP if different:**
| # | Expectation |
|---|---|
| (1) | **0 rows** — neither column exists. If present, 018 (or a variant) already ran — STOP. |
| (2) | **0 rows** — no `registrations_public_dupe` index yet. |
| (3) | 5 real regclass names. 016 + 017 must be applied first. |
| (4) | 2 rows (`applicant_phone`, `member_id`) — the partial index references both. |

---

## VERIFY — after applying 018

```sql
-- (1) both columns exist with the right types/defaults
select column_name, data_type, column_default, is_nullable
  from information_schema.columns
 where table_schema='public' and table_name='events'
   and column_name in ('public_registration_enabled','public_token')
 order by column_name;

-- (2) public_token is UNIQUE (its unique index/constraint exists)
select conname, pg_get_constraintdef(oid)
  from pg_constraint
 where conrelid='public.events'::regclass and contype='u'
   and pg_get_constraintdef(oid) ilike '%public_token%';

-- (3) the newcomer-dupe partial unique index exists with the exact predicate
select indexdef from pg_indexes
 where schemaname='public' and tablename='registrations'
   and indexname='registrations_public_dupe';

-- (4) NO new RLS policy was added for the public surface (still only the 016 SELECT policy)
select polname, polcmd from pg_policy
 where polrelid='public.registrations'::regclass
 order by polname;

-- (5) a default event has the gate CLOSED (enabled=false, token null) until an admin opens it
select public_registration_enabled, public_token
  from public.events order by created_at desc limit 3;
```

**Expect:**
| # | Expectation |
|---|---|
| (1) | `public_registration_enabled` boolean, default `false`, `NOT NULL`; `public_token` text, default null, `is_nullable = YES`. |
| (2) | One unique constraint over `(public_token)`. |
| (3) | `CREATE UNIQUE INDEX registrations_public_dupe ON public.registrations USING btree (event_id, applicant_phone) WHERE ((member_id IS NULL) AND (status = ANY (ARRAY['pending'::text, 'approved'::text])))`. |
| (4) | **Exactly the one 016 SELECT policy** (`events module can read registrations`, `polcmd='r'`). **No new public/anon policy.** |
| (5) | Existing rows: `public_registration_enabled = false`, `public_token = null` (gate closed by default). |

**Negative gate check (SQL Editor runs as superuser — no session):**
```sql
-- the public surface never uses the anon Postgres role; this just confirms the module
-- gate still returns false with no session (defense-in-depth unchanged by 018)
select public.has_module_access('events','view');   -- expect false
```

---

## API test matrix — `/api/public/**` (run LOGGED OUT; browser fetch)

Prereq: pick an open event with `per_item` meals — **XLFM-2608** (from B2/C0). Have a known
active member (**测试会员**, with a phone on file) and note a random unused phone.

### 0. Staff: open the public form (logged in as an events:edit user — Ken)
```js
// PATCH the event to enable public registration; server mints the token on first enable.
await fetch('/api/dashboard/events/<EVENT_ID>', {
  method:'PATCH', headers:{'content-type':'application/json'},
  body: JSON.stringify({ public_registration_enabled: true })
}).then(r=>r.json());
// → event.public_registration_enabled=true, event.public_token='<~16 urlsafe chars>'.
// Copy the token. Confirm an audit_log row (module 'events', action 'update') recorded it.
```
- [ ] Re-PATCH `{public_registration_enabled:false}` then `{true}` again → **same token** (reuse), not a new one.

### 1. GET public event (open a fresh logged-out tab / incognito for the rest)
```js
await fetch('/api/public/events/<TOKEN>').then(r=>r.json());
```
- [ ] Returns `{ event: {...} }` with ONLY public-safe fields: `id, code, title, event_type,
  organizing_centre:{name_cn,name_en}, starts_on, ends_on, location, reg_deadline, capacity,
  approved, remaining, reg_edit_cutoff_days, fees[], meal_slots[]`.
- [ ] **No private fields** leak — no `created_by`, `updated_by`, `public_token`, `status`,
  `requires_approval`, `co_centre_ids`, `description`, no organizing-centre `id`/`code`.
- [ ] `meal_slots` contains **only offered** cells.
- [ ] A **disabled** token (`{public_registration_enabled:false}`), a **blank** token, and a
  **garbage** token (`/api/public/events/xxxxxxxx`) each → **404** (identical shape — no signal).
- [ ] Close the event via the staff status route (open→closed) → GET → **404**. Re-open for the rest.

### 2. identify by phone
```js
const id = (p)=>fetch('/api/public/events/<TOKEN>/identify',{method:'POST',
  headers:{'content-type':'application/json'},body:JSON.stringify({phone:p})}).then(r=>r.json());
await id('<测试会员 phone>');   // matched
await id('0100000000');        // random
```
- [ ] Matched → `{ matched:true, maskedName:'测＊＊', maskedCentre:'<centre 中文名>' }` and
  **NO `member_id`, no full name, no other field**.
- [ ] Random phone → `{ matched:false }` (identical shape, nothing else).
- [ ] Malformed phone (`'abc'`) → **400** (`电话号码格式不正确`). Extra body key → **400**.

### 3. register — matched member
```js
await fetch('/api/public/events/<TOKEN>/register',{method:'POST',
  headers:{'content-type':'application/json'},
  body:JSON.stringify({ phone:'<测试会员 phone>',
    selections:{ meals:['<offered date>:lunch'], nights:2, transfer:true, uniform:{size:'M',qty:1} } })
}).then(r=>r.json());
```
- [ ] → `{ reg_no:'XLFM-2608-NNNN', status:'pending', fee_total:<number> }`.
- [ ] **Fee snapshot is correct** — recomputed server-side; equals what the fee rows imply for
  those selections (never the client's number). Confirm in the staff queue: the reg is `pending`,
  `member_id` set, `applicant_*` null, `fee_breakdown` snapshotted.
- [ ] `audit_log`: a row `module='events', action='create', table_name='registrations',
  actor_id = null, actor_email = 'public', after = {reg_no, matched:true, fee_total}`.
- [ ] Register the **same member again** → **409** `{ error:'您已报名此活动',
  existing:{reg_no:'XLFM-2608-＊＊＊＊'} }` (masked — no full reg_no).
- [ ] Submit a meal key that is **not offered** → **400** (`餐点选项无效（未供应）`).

### 4. register — NEW phone (newcomer, no member created)
```js
// baseline first:  select count(*) from members;   -- note N
await fetch('/api/public/events/<TOKEN>/register',{method:'POST',
  headers:{'content-type':'application/json'},
  body:JSON.stringify({ phone:'0111111111', name:'陈测试', name_en:'Tan Test',
    centre_id:'<some active centre id>', selections:{ nights:1 } })
}).then(r=>r.json());
// after:  select count(*) from members;   -- expect STILL N (unchanged)
```
- [ ] → `pending` reg with a reg_no; in the DB `member_id` is **null**, `applicant_name='陈测试（Tan Test）'`,
  `applicant_phone='60111111111'`, `notes` shows the captured centre.
- [ ] **`select count(*) from members` is UNCHANGED** — NO member row was created.
- [ ] Register the **same new phone again** → **409** (`此电话已报名此活动`) — the partial unique
  index / pre-check fired.
- [ ] Newcomer with **no `name`** → **400** (`请填写姓名`). Invalid `centre_id` → **400**.

### 5. lookup by reg_no + phone
```js
const look = (reg,p)=>fetch('/api/public/lookup',{method:'POST',
  headers:{'content-type':'application/json'},body:JSON.stringify({reg_no:reg,phone:p})}).then(r=>r.json());
await look('<reg_no from step 3>','<测试会员 phone>');   // owner
await look('<reg_no from step 3>','0100000000');         // wrong phone
```
- [ ] Owner → `{ reg_no, status:'pending', fee_total, event:{title,code,starts_on,ends_on},
  selections:{...summary...} }` (derived summary, not raw jsonb; no member_id, no other reg).
- [ ] Wrong phone → **404**. Unknown reg_no → **404** (identical — no ownership signal).

### 6. anonymity + isolation
- [ ] All `/api/public/**` calls **ignore any session cookie** — repeat step 1–5 while ALSO
  logged in as a volunteer in the same browser: responses are identical (the routes never read
  cookies / never call `requireModuleAccess`). Being logged in grants nothing extra and being
  logged out is never blocked.
- [ ] The public surface **never** touches the care wing and **never** lists members: only the
  masked phone-match (identify) and the caller's own registration (lookup) are ever exposed.
- [ ] Cross-site guard: a POST with a mismatched `Origin` header → **404** (same-origin gate).
