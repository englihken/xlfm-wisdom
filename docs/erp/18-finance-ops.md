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

## Deferred to 025B

D1 财务总览 (all-centres aggregate), D5 会员自查 (public `/f` phone-verified self-lookup), D6 盈余互助
(mutual-aid fund), expense **receipt photos** (private bucket), and online payments (FPX/TNG). None are
built here.
