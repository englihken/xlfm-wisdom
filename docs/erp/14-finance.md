# Phase D, Step 1 — finance foundation: schema + wiring (migration 020)

Covers `migrations/020_finance_foundation.sql`: the members fee-pledge / waiver columns, the
four finance tables (`fee_payments`, `centre_finance_months`, `expenses`, `mutual_aid_entries`),
their finance-gated + centre-scoped RLS, and the two future finance role bundles. **No API
routes and no UI ship in this step** — this is purely the data substrate the Phase D finance
routes will build on.

> **This step applies SQL ONLY.** There is no code to deploy alongside it. Run the PREFLIGHT,
> apply `020` in the Supabase SQL Editor, then run VERIFY. Nothing in the app reads these
> tables yet, so apply order is unconstrained.

## Design rationale (why the schema looks like this)

The charity's ethos — 只求维持不求盈利 — shapes every table (approved in
`XLFM_Phase_D_Design_Mockup.html`):

- **No automatic cap → manual pause + transparency.** There is no ceiling column. A centre
  that has met a month's needs sets `centre_finance_months.collection_paused = true` (with an
  optional `paused_note` for transparency). Collection is a human decision, visible to all —
  never an enforced limit.
- **Pledges vary per member and are optional.** `members.fee_pledge_amount` is per-member and
  `NULL` means **未认捐** (has not pledged). It is never coerced.
- **Waived is first-class, not a pledge of 0.** `members.fee_waived_from` (+ `fee_waiver_note`)
  is a distinct 豁免 state, so "waived" is never confused with "hasn't pledged". The two columns
  are independent.
- **Payments cover EXPLICIT month ranges.** `fee_payments.months_from … months_to` are stored
  first-of-month dates recording exactly which months a receipt covers. The range is **never**
  derived from `amount ÷ pledge` — a member may pay any amount for any stated span.
- **Receipt numbers are a per-centre sequential book.** `UNIQUE (centre_id, receipt_no)`; the
  app mints the next number per centre. Two centres may both have receipt `001`.
- **No "overdue" ethos.** There is deliberately no due-date column and no shaming/red state,
  matching C3 (019). A member has, or has not, paid for a month — nothing more.
- **No deletes; corrections are voids.** `fee_payments` and `expenses` carry
  `voided_at/voided_by/void_reason`; pause and waiver are status columns. Nothing is ever
  physically removed, and every write is `writeAudit`-logged by the (later) service-role routes.
- **归集 is manual.** The mutual-aid fund's monthly surplus collection records
  `mutual_aid_entries('in')` rows via a manual action — there is **no cron / scheduled job**.
  A disbursement (`'out'`) must cite a 理事会 `resolution_no` (DB-enforced).

## Security model

Every finance table has RLS **on** with a **SELECT-only** policy of the established shape:
`has_module_access('finance','view') AND centre_scope_allows(centre_id)`
(`mutual_aid_entries` also admits fund-level rows where `centre_id IS NULL`). There are **no**
INSERT/UPDATE/DELETE policies — all writes go through Phase D service-role routes. The new
`members` fee columns are covered by the existing `members` SELECT policy from 015; no members
policy is altered here.

**Module wiring.** `admin` and `erp_admin` already hold `finance:admin`, and `committee` holds
`finance:view` (seeded in 013) — unchanged. This migration seeds two future roles and widens
the `volunteers` role CHECK so they can be assigned:

| role key | 中文 | grant | intended scope (per-volunteer) |
|---|---|---|---|
| `finance_director` | 财务总监 | `finance:admin` | `all_centers` |
| `centre_finance`   | 中心财政 | `finance:edit`  | `own_center` |

The `all_centers` / `own_center` dimension is **`volunteers.scope`** (a per-account setting from
015), applied when the account is created — it is not part of `role_grants`.

---

## PREFLIGHT — before applying 020 (STOP on deviation)

```sql
-- (1) none of the four finance tables exist yet — expect four NULLs
select to_regclass('public.fee_payments')          as fee_payments,
       to_regclass('public.centre_finance_months')  as centre_finance_months,
       to_regclass('public.expenses')               as expenses,
       to_regclass('public.mutual_aid_entries')     as mutual_aid_entries;

-- (2) the members fee columns do NOT exist yet — expect 0 rows
select column_name from information_schema.columns
 where table_schema='public' and table_name='members'
   and column_name in ('fee_pledge_amount','fee_pledge_period','fee_waived_from','fee_waiver_note');

-- (3) the two finance role bundles are NOT seeded yet — expect 0 rows
select role, module, access from public.role_grants
 where role in ('finance_director','centre_finance');

-- (4) the substrate 020 depends on exists: centres/members/volunteers + the two gate fns
select to_regclass('public.centres')  as centres,
       to_regclass('public.members')  as members,
       to_regclass('public.volunteers') as volunteers;
select proname from pg_proc
 where proname in ('has_module_access','centre_scope_allows') order by proname;

-- (5) finance is already a valid role_grants module (015) — expect it listed in the CHECK
select pg_get_constraintdef(oid) from pg_constraint
 where conrelid='public.role_grants'::regclass and contype='c'
   and pg_get_constraintdef(oid) ilike '%module%';
```
**Expect — STOP if different:** (1) all four `NULL` · (2) 0 rows · (3) 0 rows ·
(4) `centres`/`members`/`volunteers` all non-null and both `centre_scope_allows` +
`has_module_access` present · (5) the CHECK lists `finance` among the nine modules.

---

## APPLY

Paste **all of `migrations/020_finance_foundation.sql`** into the Supabase SQL Editor and run it
once. It is one transaction of DDL — tables, indexes, RLS policies, the two seed rows, and the
widened role CHECK.

---

## VERIFY — after applying 020

```sql
-- (1) the four tables now exist
select to_regclass('public.fee_payments')          as fee_payments,
       to_regclass('public.centre_finance_months')  as centre_finance_months,
       to_regclass('public.expenses')               as expenses,
       to_regclass('public.mutual_aid_entries')     as mutual_aid_entries;

-- (2) the four members fee columns exist and are all NULLable
select column_name, data_type, is_nullable
  from information_schema.columns
 where table_schema='public' and table_name='members'
   and column_name in ('fee_pledge_amount','fee_pledge_period','fee_waived_from','fee_waiver_note')
 order by column_name;

-- (3) RLS is ON for all four tables
select relname, relrowsecurity from pg_class
 where relnamespace='public'::regnamespace
   and relname in ('fee_payments','centre_finance_months','expenses','mutual_aid_entries')
 order by relname;

-- (4) exactly ONE SELECT policy per table, all finance-gated + centre-scoped, and NO
--     insert/update/delete policy on any of them
select polrelid::regclass as tbl, polname, polcmd, pg_get_expr(polqual, polrelid) as using_expr
  from pg_policy
 where polrelid in ('public.fee_payments'::regclass,'public.centre_finance_months'::regclass,
                    'public.expenses'::regclass,'public.mutual_aid_entries'::regclass)
 order by tbl, polname;

-- (5) the mutual-aid resolution CHECK exists (an 'out' row must cite a resolution_no)
select pg_get_constraintdef(oid) from pg_constraint
 where conrelid='public.mutual_aid_entries'::regclass and contype='c'
   and conname='mutual_aid_out_needs_resolution';

-- (6) the per-centre receipt book UNIQUE exists
select pg_get_constraintdef(oid) from pg_constraint
 where conrelid='public.fee_payments'::regclass
   and conname='fee_payments_receipt_book';

-- (7) the two finance role bundles are seeded
select role, module, access from public.role_grants
 where role in ('finance_director','centre_finance') order by role;

-- (8) the volunteers role CHECK now includes the two finance roles
select pg_get_constraintdef(oid) from pg_constraint
 where conrelid='public.volunteers'::regclass and conname='volunteers_role_check';
```

**Expect:**

| # | Expectation |
|---|---|
| (1) | all four `regclass` values non-null. |
| (2) | 4 rows; all `is_nullable = YES`; `fee_pledge_amount` numeric, `fee_pledge_period`/`fee_waiver_note` text, `fee_waived_from` date. |
| (3) | `relrowsecurity = true` for all four. |
| (4) | exactly one `r` (SELECT) policy per table; each `using_expr` contains `has_module_access('finance','view')` and `centre_scope_allows(...)` (mutual_aid additionally `centre_id IS NULL OR`); **no** `a`/`w`/`d` (insert/update/delete) rows. |
| (5) | `CHECK ((entry_type <> 'out'::text) OR (resolution_no IS NOT NULL))`. |
| (6) | `UNIQUE (centre_id, receipt_no)`. |
| (7) | 2 rows — `('centre_finance','finance','edit')` and `('finance_director','finance','admin')`. |
| (8) | CHECK lists `admin, volunteer, erp_admin, committee, finance_director, centre_finance`. |

### Constraint spot-checks (optional, prove the guards bite)

```sql
-- first-of-month invariant rejects a mid-month coverage date
--   → expect: violates check constraint "fee_payments_months_from_check"
-- 'out' without a resolution_no is rejected
--   → expect: violates check constraint "mutual_aid_out_needs_resolution"
-- months_to < months_from is rejected
--   → expect: violates check constraint "fee_payments_month_range"
```
(Run these as throwaway INSERTs inside a `begin; … rollback;` if you want live proof — each must
raise the named check violation. Amounts must be `> 0` on `fee_payments`, `expenses`, and
`mutual_aid_entries`.)

---

## Open questions (carried to the next Phase D step)

1. **Do the finance roles need a `members` grant?** `finance_director` / `centre_finance` are
   seeded with the finance module only. To read the member roster / pledges via direct PostgREST
   they would need `members:view`. The plan is for the finance routes to read pledges via
   service-role (bypassing RLS), so no members grant is seeded yet — confirm before building the
   pledge UI.
2. **Receipt-number minting.** `receipt_no` is app-minted per centre (guarded by the UNIQUE
   book). Step 2 decides where the sequence lives (a helper function vs. a route-level counter).
3. **Expense receipt bucket.** `expenses.receipt_path` is reserved for a private Storage bucket
   wired in a later step, mirroring C3's `payment-proofs` (019).
