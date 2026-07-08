# Inventory wing — 结缘品 warehouse + per-centre stock (migration 022 + pages)

Covers `migrations/022_inventory.sql` (schema, role wiring, seed data — **applied to prod
2026-07-08** via the Supabase connector, recorded as migration `022_inventory`) and the
库存 dashboard pages built on top of it. Replaces the 仓库书籍 RECORD .xlsx spreadsheet
(18 sheets of conflicting stock-count columns) with a movements ledger the whole 团队 can trust.

> Seed verified: **239 items** (220 coded + 19 uncoded), **37 locations** (总会仓库 + 36
> centres), **76 opening movements / 1,007,092 units**, 3 role grants, balances view
> 239 × 37 = 8,843 rows. Spot checks: 天地人 S001B0301 = 1,378; 念佛机 = 2,240.

## Why a ledger, not a balance column

The spreadsheet's core failure mode: five "current stock" columns from different dates that
disagree ("红色=不一样"). The module stores **every movement** and *derives* balances, so
there is exactly one answer to "how many do we have" per item per location, and every number
traces to who moved what, when, for which 法会.

## Schema

| Table | Purpose |
|---|---|
| `inventory_items` | Catalog. Legacy `stock_id` kept + unique; 19 uncoded items have `stock_id NULL` (category `uncoded`). |
| `inventory_locations` | 1 × `hq_warehouse` (总会仓库) + 1 `centre` store per active centre. |
| `inventory_movements` | The ledger; direction CHECK per type; optional `event_id` ties 结缘 outflow to a 法会. |
| `inventory_requests` | 分会 orders: `qty_requested` vs `qty_fulfilled`; backorder = difference (总会还欠分会). |
| `inventory_balances` | View (security_invoker): item × location derived qty. |

### Movement semantics

| type | from | to | spreadsheet equivalent |
|---|---|---|---|
| `opening` | — | loc | seeded baseline (2026-03-02 column, **UNVERIFIED**) |
| `stock_in` | — | loc | new arrival from printer/supplier |
| `transfer` | loc | loc | 总会 → 分会 delivery |
| `distribution` | loc | — | 结缘出去数量 |
| `return` | loc | loc | 退回仓库 |
| `adjust_in` / `adjust_out` | one side | — | stock-take correction |

## App surface (built)

API (all `requireModuleAccess('inventory', …)`; writes audit via `writeAudit`):
`GET api/dashboard/inventory/meta` (locations + catalog + recent events — served under the
inventory grant so tagging a 法会 never needs events:view) · `GET …/balances?location_id=`
· `GET/POST …/movements` (POST enforces direction rules + a negative-stock guard 库存不足;
GET with `event_id` also returns the per-item 拣货 summary) · `GET/POST …/requests` ·
`POST …/requests/[id]/fulfil` (creates the HQ→centre transfer + advances the request,
manual-rollback on failure) · `PATCH …/requests/[id]/status` (cancel remainder only).

Pages (ErpGate `module="inventory"`, nav door 库存 via `visibleModules`):
`/dashboard/inventory` (库存总览 — location selector, KPI strip, filterable balances table)
· `…/movements` (变动记录 — filtered ledger + 拣货·发放汇总 card when a 法会 is selected)
· `…/movements/new` (记录变动 — one form for all six creatable types; 从仓/到仓 follow the
direction rule) · `…/requests` (分会申请 — queue, inline create, 拨付 with qty, 取消).

Security note: writes stay service-role mediated behind grant-checked routes (house
pattern); RLS on the tables is SELECT-only via `has_module_access('inventory','view')`.
Grants: admin=admin, erp_admin=admin, committee=view.

## Follow-ups

1. **Stock-take before the Aug 法会** — the 76 seeded balances are provisional; verify via
   盘点调增/调减, and count the items that seeded at 0.
2. **Assign StockIDs** to the 19 uncoded items (念佛机, 计数器, 无烟香, 米袋, comics, 护身卡 …).
3. Centres added later do **not** auto-get a store location — create one alongside.
4. v2 candidates: centre-scoped visibility (centre volunteers see only their own store),
   low-stock thresholds, CSV export for the printing team.
