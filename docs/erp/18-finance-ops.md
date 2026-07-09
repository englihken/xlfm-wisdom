# Finance ops (025A) — 月费台账 / 收款 / 支出 / 认捐 + 财务 door

Builds the D2/D3/D4 screens of the approved design (`docs/erp/mockups/phase-d-finance.html`) on
`migrations/020_finance_foundation.sql` (**applied to prod 2026-07-10**, advisor side — the earlier
manual apply had never landed; never run SQL locally). D1 overview, D5 public self-lookup, and D6
mutual aid are **025B — not built here**.

## The scope wall (new pattern — the real guard)

Finance rows are centre-owned. RLS (`finance:view AND centre_scope_allows(centre_id)`) protects
logged-in reads, but the Phase D routes run as **service-role** (bypassing RLS), so the server-side
check in `src/lib/finance.ts` is the real wall:

- `financeScope(db, volunteerId)` reads `volunteers.scope` + `centre_id`. `own_center` (and not an
  all-centre role — admin/erp_admin/finance_director) → `{ centreId, locked: true }`; otherwise
  `{ centreId: null, locked: false }` (all centres).
- `enforceScope(scope, requested)` — every route resolves scope and, when **locked**, forces the
  request's centre to the volunteer's own centre (**400** on any other `centre_id`, or an omitted one
  is filled in). An own_center 财政 can never read or write another centre's finance data even though
  the query itself is service-role.

The two Phase D roles: `finance_director` (finance:admin, scope all_centers) and `centre_finance`
(finance:edit, scope own_center). Grants gate the action; scope gates the centre.

## Receipt book semantics

Receipt numbers are a **per-centre sequential book** (`UNIQUE (centre_id, receipt_no)`).
`nextReceiptNo` reads the centre's highest numeric receipt, +1, zero-padded to that width (empty book →
`0000001`). It **prefills** the 记录收款 form but the 财政 may edit it (衔接旧收据簿 — legacy numbers).
The POST is the real guard: a unique-violation returns a friendly **400 "收据号已被使用，请刷新号码"** so
two 财政 entering at once never silently clash.

## 月费台账 grid + ethics

One row per active member: 赞助者 (name + phone) · 认捐 pill (`RM50/月` · `RM600/年` · `已豁免` lav ·
`未认捐` muted) · 付至 (max `months_to` of non-void payments, green; `豁免中` for waived) · then **12
month cells**. Per cell: `waived` (month ≥ `fee_waived_from`, lavender) > `paid` (a non-void payment
whose `months_from … months_to` covers the month — gold √, hover shows 收据号·日期·金额·录入人) >
`future` (dashed) > `empty`. **An empty cell is UNPAID, never "overdue"** — the footer states this
verbatim; we only ever state 付至, never chase. Amounts and month ranges are stored explicitly and
**never derived** from amount ÷ pledge. Pledge and waiver are **independent** columns — a waived member
may keep a historical pledge; the 认捐/豁免 modal edits both separately.

Header **pause chip** toggles this month's `centre_finance_months.collection_paused` (收款中 ↔
本月已足·已暂停 + note) — the manual transparency-over-cap model; there is no automatic ceiling.

## APIs (all `requireModuleAccess('finance', …)` + `financeScope`; `writeAudit` module 'finance' on every mutation)

`GET meta` (scope-filtered centres + receipt-book position + this-month pause) · `GET ledger?centre_id=&year=`
(members + non-void payments intersecting the year; `?include_void=1` adds voided) ·
`GET payments/next-receipt` · `POST payments` (explicit month range; unique-violation → friendly 400) ·
`POST payments/[id]/void` (reason required) · `PATCH members/[id]/pledge` (independent pledge/waiver;
audited as table `members`) · `GET/POST expenses` (category enum; `receipt_path` NULL this batch) ·
`POST expenses/[id]/void` · `PATCH months` (upsert pause). Corrections are **voids, never deletes**.

## Shell

`access.ts` (ModuleDoor + visibleModules) + `dashboard-nav` (coins icon) + `erp-gate` MODULE_META +
home single-door bounce all gained `finance` → `/dashboard/finance` (finance:view). Shared tab row
`src/components/finance-chrome.tsx` = 月费台账 · 支出记录.

## 025B — 总览 / 盈余互助 / 会员自查 + receipt photos + void display

Migration `026_finance_receipts_bucket.sql` (**applied to prod 2026-07-10**): private bucket
`finance-receipts`. The ledger moved to `/dashboard/finance/ledger`; `/dashboard/finance` is now the D1
总览. Tab row: 总览 · 月费台账 · 支出记录 · 盈余互助.

**Void display fix.** The 月费台账 member panel fetches `?include_void=1` and renders voided payments
struck-through with their reason (`№0000963 (已作废：…)`). A consumed receipt number stays **visible** in
the book — never silently vanishes.

**D1 总览 stats** (`GET /api/dashboard/finance/stats?month=`, scope-aware — own_center sees only their
centre). Definitions: `collected` = Σ non-void `fee_payments.amount` with `paid_at` in month;
`expenses` = Σ non-void `expenses.amount` with `spent_at` in month; `surplus` = collected − expenses;
`pledgedCount` = active members with a pledge set and **not** waived; `paidCount` = of those, max non-void
`months_to` ≥ month start. `centres[]` per in-scope centre (collected/expenses/surplus, pause, receipt-book
position, its `centre_finance` 财政 or 未指派). `events[]` = read-only aggregate from the events wing
(approved-fee / verified-paid / pending-proof / waived). Grouped, no N+1.

**D6 盈余互助** (`/mutual-aid`). `GET` returns the year's entries + stats (cumulative all-time in−out;
this-month in/out). `POST collect` (finance:**admin**) is **idempotent 归集**: per centre,
surplus(month) = non-void payments − non-void expenses; a centre with surplus > 0 **and no existing 'in'
row for (month, centre)** gets one — already-collected centres are SKIPPED and reported, so it re-runs
safely. A `preview:true` body dry-runs (compute, insert nothing) to power the confirm modal. `POST disburse`
(admin) requires `resolution_no` (the DB CHECK enforces it too). Fund is aggregate — 理事会 sees it, never
individual payments.

**D5 会员自查** (public `/f`, no login — `POST /api/public/fee-lookup`). Privacy model: the ONLY key is a
phone; returns MASKED names (`maskName`, the C1 pattern), centre, pledge, paidThrough, last 12 non-void
payments, and the centre's current-month transparency block — **no ids, no unmasked names, no other
members' rows**. `sameOrigin` + `rateLimit`; an unknown phone returns a uniform empty result (no
enumeration signal). Paused centre → 本月已满，感恩 🙏. Waived → 豁免中, never an amount due.

**Expense receipt photos.** `POST /api/dashboard/finance/upload` (finance:edit → `finance-receipts`
`receipts/<uuid>.<ext>`) + `GET media-url` (signed). `expenses` POST accepts an optional `receipt_path`
(`^receipts/` validated); the ＋记支出 modal has a `capture="environment"` photo input; rows show 📎 →
signed URL. 支出记录 also gained a client-side CSV export (voids marked).

## Still deferred (LATER)

Online payments (FPX/TNG) and the A5 historic-ledger import (Melaka xlsx) — neither is built.
