# Inventory v2 (023A) — approval workflow, dashboard, item drawer, catalog

Builds on the [016 inventory wing](16-inventory.md). Covers `migrations/023_inventory_workflow.sql`
(**applied to prod 2026-07-09** via the Supabase connector, advisor side — recorded as migration
`023_inventory_workflow`; never re-run locally) and the 库存 v2 pages built on it. The agreed UI is
`docs/erp/mockups/inventory-v6.html`.

> 023B (Excel import, QR labels, 盘点模式 stock-take) is deliberately **out of scope** here.

## What 023 added to the schema

- `inventory_items`: `category_cn` (the 8 display categories — 经文·纸类, 书籍·善书, 佛具·菩萨像 … —
  distinct from the legacy `category` StockID prefix), `photo_path`, `low_stock_line`. All 239 items
  were categorised advisor-side.
- `inventory_requests`: a **6-status lifecycle** `pending → approved → partial → fulfilled`, plus
  `rejected` / `cancelled`; `qty_approved`, `approve_reason`, `approved_by`, `approved_at`,
  `rejected_reason`. CHECK: fulfilled ≤ approved.
- `inventory_movements`: `photo_path` (存证/到货 photo), `request_id` (links a release to its request),
  `reversal_of` (更正撤销 link, with a unique partial index = **at most one reversal per movement**).
- Private storage bucket **`inventory-media`** (`proofs/`, `photos/` subfolders).

## Two rules that define the workflow

**Release-only-deducts.** A request is *approved* first (authorising a quantity, with a required reason
if approved for less than requested) — approval moves **no stock**. Stock leaves the warehouse only at
**发放 / release**, which requires a 存证 photo, creates the 总会仓库 → 分会 transfer (carrying the photo
+ `request_id`), and advances `qty_fulfilled`. So "batch approved" and "actually handed over" are never
conflated, and every hand-over has photographic proof. Release is capped at the approved-but-unreleased
remainder (`qty_approved − qty_fulfilled`), guarded by the HQ negative-stock check. 取消 closes the
**remainder only** — already-released stock is untouched.

**Reversal, never deletion.** The ledger stays append-only. 更正撤销 writes the **exact opposite**
movement (sides swapped, matching type so the DB direction CHECK holds, same item/qty, `reversal_of` set,
note `更正撤销`) — inbound → adjust_out, outbound → adjust_in, transfer/return → swapped. Who may reverse:
the movement's **own creator within 24h, or an inventory:admin anytime**. Refused if the target is itself a
reversal, already has a reversal, or is a seed `opening` (correct those via a future stock-take). The
negative-stock guard applies to the opposite move.

**Reversal rewinds the request.** When the reversed movement was a 分会 release (carries `request_id`), the
parent request is rewound in the same transaction-style step: `qty_fulfilled −= original.qty` (floored at 0)
and the status is recomputed — `0 → approved`, `< qty_approved → partial`, `== qty_approved → fulfilled` — so
the pipeline card numbers always agree with the ledger (a fully-reversed request drops back to ② 已批准·备货中
automatically, since columns follow status). **Exception:** a request already `cancelled`/`rejected` keeps its
status; only the counter moves. If the request rewind fails, the reversal movement is rolled back and the call
errors (same manual-compensation pattern as release). Both the movement and the request rewind are audited
(with before/after).

## App surface (built)

New/changed API (all `requireModuleAccess('inventory', …)`, every mutation audited):

- `POST …/upload?kind=proof|photo` (edit) → `{ path }` into `inventory-media`; `GET …/media-url?path=`
  (view) → short-lived signed URL. Mirror the registrations payment-proof pattern.
- `POST …/requests/[id]/approve` (**admin**) · `POST …/requests/[id]/reject` (**admin**, reason required)
  · `POST …/requests/[id]/release` (edit, qty + photo required) — **replaces** the old `fulfil` route ·
  `PATCH …/requests/[id]/status` now cancels from pending/approved/partial · `GET …/requests` returns the
  new fields and filters all 6 statuses.
- `POST …/movements` accepts an optional `photo_path`; `POST …/movements/[id]/reverse` (edit, 24h/creator
  rule) · `GET …/movements` returns `photo_path` + reversal linkage and accepts `?request_id=`.
- `GET …/stats` (view) — dashboard aggregates from a bounded, no-N+1 set of reads (catalog + non-zero
  balances + pending count + 90-day movements): KPIs, low-stock+purchasing, top movers, category totals,
  holdings. `GET/PATCH …/items/[id]` (drawer + edit) · `GET/POST …/items` (catalog list + create) · meta
  now returns the distinct `category_cn` list.

Pages (ErpGate `module="inventory"`; a shared tab row 仪表板 · 库存明细 · 分会申请 · 变动记录 · 品项管理
and a global item search sit on every page — a hit opens the shared **item drawer**
`src/components/inventory-item-drawer.tsx`):

- `/dashboard/inventory` = **仪表板**: 5 KPIs, 低库存·采购建议 (⬇ CSV 采购清单), 最常发放 + 各分类库存 bars
  (click → 明细 filtered), 库存在哪里. Every card drills down.
- `…/stock` = **库存明细** (the relocated per-location table): drawer on row click, 低库存 filter, load-more,
  ⬇ CSV.
- `…/requests` = **分会申请**: 3-column pipeline (待审批 / 已批准·备货中 / 已发放) with approve / reject /
  release modals (release input = `file … capture="environment"` → upload → release), release photo
  thumbnails + ↩退回/撤销, and reasons on rejected/cancelled cards.
- `…/catalog` = **品项管理**: category chips + search, ＋新品项 / 编辑 modals (photo optional), 停用/启用.
- `…/movements`: 📷 indicator (signed-URL preview), ↩撤销 per the 24h/creator rule, reversal rows labelled
  更正撤销.

Grants unchanged: admin=admin, erp_admin=admin, committee=view. Approve/reject need **admin**;
release/reverse and item CRUD need **edit**; stats/list/drawer need **view**.

## 023B — 盘点模式, 大件标签, 手机扫码, 分享库存表, CSV 导入

Migration `024_stocktake_and_share.sql` (**applied to prod 2026-07-09**, advisor side — canonical
record only): `inventory_stocktakes` + `inventory_stocktake_lines`, `inventory_movements.stocktake_id`
trace link, `inventory_share_links`.

**盘点模式 (guided stock-take).** A session snapshots one line per active item in scope (a location,
optionally one category_cn) with `system_qty` = the item's current derived balance at creation.
Counting fills `counted_qty` per line (存草稿 = bulk upsert). **Confirm** is the important part and
follows one rule — **the counted value wins**: for each *counted* line it recomputes the item's CURRENT
balance (not the snapshot), writes an `adjust_in`/`adjust_out` for `counted − current` (linked via
`stocktake_id`, note `盘点 <id8>`), and sets the system to the count. Uncounted lines are skipped (and
reported). If `current ≠ system_qty` (stock moved mid-count) the item is returned in `driftWarnings` —
informational; the count is still applied. Manual rollback: any failure mid-confirm deletes this
session's movements (by `stocktake_id`) and leaves it draft. The page prints a paper count sheet (a
self-contained print window), and 📷 扫码 jumps to / focuses the scanned item's row. Confirmed sessions
are read-only with their adjustments listed.

**大件标签 (selective labels).** 品项管理 rows have checkboxes → 🏷️ 打印标签 opens
`/dashboard/inventory/labels?ids=…`, an A4 2-col print grid: name_cn large, StockID mono, category pill,
and a QR (dep-free `src/lib/qr.ts`) encoding `${origin}/dashboard/inventory?item=<id>`. Browser print;
a print stylesheet shows only the label sheet. For big items (菩萨像/器材/整箱) — books don't need one.

**手机扫码.** 📷 扫码 sits next to the global search on every 库存 page. Live camera
(`getUserMedia`, environment-facing), decoded by native `BarcodeDetector` when present else a
dynamic-imported `jsqr` (dep added). A decoded `…?item=<uuid>` URL / raw uuid / exact StockID opens the
item drawer; no camera / permission → a friendly message pointing to the search box. 仪表板 + 库存明细
honor `?item=<id>` on load (what the QR encodes).

**分享库存表 (read-only live link).** 仪表板 → 🔗 分享库存表 (inventory:**admin**) manages
`inventory_share_links` (create with a 24-char crypto token, revoke). Public `GET /api/public/inventory/[token]`
(active token, service-role) returns ONLY 总会仓库 non-zero balances (name_cn, stock_id, category_cn,
qty) — no prices, no per-location breakdown, no edits. Page `/s/[token]` is anonymous, mobile-first
(like `/r/[token]`): title 结缘品库存（总会）, search + category filter; an invalid/revoked token shows
链接已失效.

**CSV 品项导入.** 品项管理 → ⬆ CSV 导入: a client-made template
(`name_cn*,category_cn*,stock_id,pack_qty,low_stock_line,remark`), client-side parse (quoted fields with
commas handled) + per-row preview/validation, then `POST /items/import` re-validates server-side and
inserts row-by-row so a bad/duplicate row fails alone; results are shown per row and one `import` audit
entry records the counts.

## Follow-ups

1. 023B: Excel bulk import, QR label PDFs, 盘点模式 (stock-take) — the mockup's 盘点 flow is designed but
   not built.
2. `low_stock_line` is only set for items where an advisor filled it — items without a line never appear in
   低库存 / 采购建议 by design.
3. Migration record: `migrations/023_inventory_workflow.sql` is the canonical DDL applied to prod (never
   re-run). Keep it in step with any future advisor-side schema change to the inventory tables.
