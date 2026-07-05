# B1 — Phase B events schema: verification

Covers `migrations/016_events_schema.sql` (events + event_fees + event_team_needs +
registrations, all events-module + centre-scope gated). Run **PREFLIGHT** in the Supabase
SQL Editor **before** applying 016 (each statement alone; STOP on any deviation), and
**VERIFY** after applying. No app code ships in B1 — nothing to deploy/test in the UI yet.

---

## PREFLIGHT — before applying 016 (STOP on deviation)

```sql
-- (1) none of the 4 events tables exist yet — expect 4 × NULL
select to_regclass(t) from unnest(array[
  'public.events', 'public.event_fees', 'public.event_team_needs', 'public.registrations'
]) t;

-- (2) role_grants module CHECK already includes 'events' (from 015's 9-key vocabulary)
select pg_get_constraintdef(oid) from pg_constraint
 where conrelid = 'public.role_grants'::regclass and contype = 'c'
   and pg_get_constraintdef(oid) ilike '%module%';

-- (3) grant seed intact — expect 16
select count(*) from public.role_grants;
```

**Expect — STOP if different:**
| # | Expectation |
|---|---|
| (1) | 4 rows, **all `NULL`** (no events table exists). If any is non-null, that table already exists — STOP. |
| (2) | The 9-key CHECK from 015, which **includes `events`**: `CHECK ((module = ANY (ARRAY['care','members','events','finance','duty','inventory','reports','settings','audit'])))`. |
| (3) | `16` (the A2 grant seed is present and unchanged). |

---

## VERIFY — after applying 016

```sql
-- (1) all 4 tables exist — expect 4 real regclass names, no NULLs
select to_regclass(t) from unnest(array[
  'public.events', 'public.event_fees', 'public.event_team_needs', 'public.registrations'
]) t;

-- (2) RLS on for all 4 — expect rowsecurity = true ×4
select tablename, rowsecurity from pg_tables
 where schemaname = 'public'
   and tablename in ('events', 'event_fees', 'event_team_needs', 'registrations')
 order by tablename;

-- (3) the 4 SELECT policies + their composed quals
select polname, polrelid::regclass, polcmd, pg_get_expr(polqual, polrelid) as using_expr
  from pg_policy
 where polrelid::regclass::text in ('events', 'event_fees', 'event_team_needs', 'registrations')
 order by polrelid::regclass::text;

-- (4) event_fees six-item CHECK
select pg_get_constraintdef(oid) from pg_constraint
 where conrelid = 'public.event_fees'::regclass and contype = 'c'
   and pg_get_constraintdef(oid) ilike '%item%';

-- (5) definer gate returns false with no editor session (negative check)
select public.has_module_access('events','view');
```

**Expect:**
| # | Expectation |
|---|---|
| (1) | 4 rows, each a real name (`events`, `event_fees`, `event_team_needs`, `registrations`) — no NULLs. |
| (2) | `rowsecurity = true` (t) for all 4. |
| (3) | **Exactly 4** rows, all `polcmd = 'r'` (SELECT), **no write policies**. Quals: <br>• `events` → `has_module_access('events'::text, 'view'::text) AND centre_scope_allows(organizing_centre_id)` <br>• `event_fees` / `event_team_needs` / `registrations` → `has_module_access('events'::text, 'view'::text) AND (EXISTS ( SELECT 1 FROM events e WHERE e.id = <table>.event_id AND centre_scope_allows(e.organizing_centre_id)))`. Policy names: `events module can read <table>`. |
| (4) | `CHECK ((item = ANY (ARRAY['registration','meal','accommodation','transfer','uniform','other'])))` — the fixed six-item vocabulary. |
| (5) | `false` (SQL Editor runs as superuser — no `auth.uid()`). |

**Optional — confirm no write policies slipped in (expect only the 4 SELECT rows):**
```sql
select polrelid::regclass, polname, polcmd from pg_policy
 where polrelid::regclass::text in ('events','event_fees','event_team_needs','registrations')
 order by polrelid::regclass::text;
-- expect polcmd = 'r' for all 4, nothing else.
```

**Note:** for today's roles the scope composition changes nothing — admin and erp_admin (who
hold `events:admin` from the 013 seed) are both `all_centers`, so `centre_scope_allows` is
always true for them. The composition exists so Phase D centre-scoped event roles inherit the
proven 015 pattern. Full per-scope RLS probing lands in Phase D.

---

## What B2 / B3 will add (doc-chain continuity)
- **B2 — events API + admin UI (events module gate):** create/edit events with their enabled
  `event_fees` and `event_team_needs`; app-generated `code` (`XLFM-YYMM` + suffix); status
  transitions (draft → open → full/closed → completed); every mutation audited via
  `writeAudit(module:'events', …)`. Writes stay service-role-only behind `requireModuleAccess`.
- **B3 — registrations (admin flow):** register a member to an event, compute `fee_total` +
  snapshot `fee_breakdown` from the event's `event_fees` × `selections`, generate `reg_no`
  (`<event code>-<zero-padded seq>`), approve/reject/cancel (status only — no delete), audited.
- **Phase C (later):** public/self submission that populates `applicant_name`/`applicant_phone`
  with a null `member_id` (the reason `member_id` is nullable here), reconciled to a member by
  an admin.
