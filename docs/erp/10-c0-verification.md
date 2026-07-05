# C0 — meal grid: schema verification (migration 017)

Covers `migrations/017_event_meal_slots.sql` (the per-day-per-meal offering grid
`event_meal_slots` + the `events.reg_edit_cutoff_days` column). Run **PREFLIGHT** in the
Supabase SQL Editor **before** applying 017 (each statement alone; STOP on any deviation),
and **VERIFY** after applying.

> **DEPLOY ORDER — apply 017 FIRST, then push the C0 code.** The app reads
> `public.event_meal_slots` and `events.reg_edit_cutoff_days`; deploying the code before the
> migration would 500 the events GET (unknown column/table). Migration → verify → deploy.

---

## PREFLIGHT — before applying 017 (STOP on deviation)

```sql
-- (1) event_meal_slots does not exist yet — expect NULL
select to_regclass('public.event_meal_slots');

-- (2) events does NOT yet have the reg_edit_cutoff_days column — expect 0 rows
select column_name from information_schema.columns
 where table_schema = 'public' and table_name = 'events'
   and column_name = 'reg_edit_cutoff_days';

-- (3) the events wing is present (016 applied) — expect 4 real names, no NULLs
select to_regclass(t) from unnest(array[
  'public.events', 'public.event_fees', 'public.event_team_needs', 'public.registrations'
]) t;

-- (4) grant seed intact — expect 16
select count(*) from public.role_grants;
```

**Expect — STOP if different:**
| # | Expectation |
|---|---|
| (1) | `NULL` — no `event_meal_slots` table. If non-null it already exists — STOP. |
| (2) | **0 rows** — the column is absent. If present, 017 (or a variant) already ran — STOP. |
| (3) | 4 real regclass names (`events`, `event_fees`, `event_team_needs`, `registrations`). 016 must be applied first. |
| (4) | `16` (the A2 grant seed, unchanged — C0 adds no grants). |

---

## VERIFY — after applying 017

```sql
-- (1) event_meal_slots exists — expect a real regclass name
select to_regclass('public.event_meal_slots');

-- (2) RLS is on — expect rowsecurity = true
select tablename, rowsecurity from pg_tables
 where schemaname = 'public' and tablename = 'event_meal_slots';

-- (3) exactly ONE SELECT policy, with the composed qual (verbatim)
select polname, polcmd, pg_get_expr(polqual, polrelid) as using_expr
  from pg_policy
 where polrelid = 'public.event_meal_slots'::regclass
 order by polname;

-- (4) primary key + meal CHECK
select conname, contype, pg_get_constraintdef(oid)
  from pg_constraint
 where conrelid = 'public.event_meal_slots'::regclass
   and contype in ('p', 'c')
 order by contype;

-- (5) the new events column exists with default 3 + the >= 0 CHECK
select column_name, data_type, column_default, is_nullable
  from information_schema.columns
 where table_schema = 'public' and table_name = 'events'
   and column_name = 'reg_edit_cutoff_days';
select pg_get_constraintdef(oid) from pg_constraint
 where conrelid = 'public.events'::regclass and contype = 'c'
   and pg_get_constraintdef(oid) ilike '%reg_edit_cutoff_days%';

-- (6) definer gate returns false with no editor session (negative check)
select public.has_module_access('events','view');
```

**Expect:**
| # | Expectation |
|---|---|
| (1) | `event_meal_slots` (a real name). |
| (2) | `rowsecurity = true` (t). |
| (3) | **Exactly 1** row, `polcmd = 'r'` (SELECT). Name `events module can read event_meal_slots`. Qual: <br>`has_module_access('events'::text, 'view'::text) AND (EXISTS ( SELECT 1 FROM events e WHERE ((e.id = event_meal_slots.event_id) AND centre_scope_allows(e.organizing_centre_id))))`. **No write policies.** |
| (4) | PK `PRIMARY KEY (event_id, slot_date, meal)`; CHECK `CHECK ((meal = ANY (ARRAY['breakfast'::text, 'lunch'::text, 'dinner'::text])))`. |
| (5) | column `reg_edit_cutoff_days`, type `integer`, default `3`, `is_nullable = NO`; CHECK `CHECK ((reg_edit_cutoff_days >= 0))`. |
| (6) | `false` (SQL Editor runs as superuser — no `auth.uid()`). |

**Optional — confirm no write policy slipped in (expect only the 1 SELECT row):**
```sql
select polname, polcmd from pg_policy
 where polrelid = 'public.event_meal_slots'::regclass;
-- expect polcmd = 'r', nothing else.
```

---

## What the C0 code adds on top of 017 (doc-chain continuity)
- **Slot lifecycle (server):** on event create — and on edit when `starts_on`/`ends_on`
  change — the app upserts a slot for every date in `[starts_on, ends_on] × {breakfast,
  lunch, dinner}` (default `offered=true`), deletes slots outside the new range, and
  **preserves** the `offered` flag of dates that remain. The kitchen toggles `offered` per
  cell in the 餐点供应 grid (shown when the 餐费 row bills 每餐/per_item).
- **Fee semantics:** the meal fee may bill `per_day` (legacy, qty = `selections.meal_days`)
  **or** `per_item` (每餐, qty = `selections.meals?.length ?? 0`). Existing events keep
  `per_day` and compute exactly as before.
- **Selections editing:** `PATCH /api/dashboard/registrations/[id]/selections` recomputes the
  fee snapshot; allowed only while `pending`/`approved` **and** today < `starts_on` −
  `reg_edit_cutoff_days`, and only for meal keys that are OFFERED slots of the event.
- **Kitchen stats:** the event detail page shows a 每餐人数统计 card — per (date, meal) count
  of approved registrations whose `selections.meals` contains that key, with per-day and
  grand totals — rendered only for `per_item` meal events.
