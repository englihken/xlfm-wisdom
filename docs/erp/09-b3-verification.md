# B3 — 活动 module UI: verification

The events module UI over the B2 API (no new routes). Run after deploy. `visibleModules`
remains the single door source — it now emits `events` (after `members`, before `reports`)
when the caller holds `events ≥ view`.

Prod test data from B2: **XLFM-2608** (open, 2 regs) and **XLFM-2608B** (full).

---

## admin (Ken — all doors)
- [ ] Rail now shows **活动** (calendar icon) between 会员 and 报表; **⌂ 主页** still first (multi-door).
- [ ] `/dashboard/events` (活动总览): KPI strip 进行中 · 待审核报名 · 本月报名 · 本月活动 computed client-side; the two B2 events appear as cards with correct **status badges** (开放报名 / 已满额), type badge, centre, dates, **capacity bar** (approved/capacity), counts row (待审 red when >0), **team-needs chips** (approved/needed, 短缺 red + ⚠ when short), and the **fee-summary line** (enabled items + amounts — B2.1).
- [ ] Filters (状态/类型/中心/搜索) narrow the cards; 中心 options come from `/erp/meta`.
- [ ] **＋新建活动** → form. Create a 3rd event:
  - 基本资料 filled; 费率设置 — enable **餐费 30 / 住宿 120 / 机场接送 80 / 制服 30**, leave 报名费 & 结缘品 **disabled** (their amount inputs greyed).
  - Add a 义工团队需求 (e.g. 交通 × 5).
  - Submit → **toast shows the generated 编号** (e.g. `XLFM-2609`) → lands on the detail page; status = **草稿**. Disabled fee rows were **not** sent (verify the detail 费率 card shows only the 4 enabled items).
- [ ] Detail **发布** button (draft→open) with confirm → status becomes 开放报名; button set changes to 关闭报名 / 标记满额 / 标记结束.
- [ ] **＋代报名** (open only): search a member (active only, search-as-you-type), pick 义工组 (optional), enter selections (餐 days / 住宿 nights / 接送 / 制服 size+qty — only the enabled items render). The **live fee preview** total equals what the server stores on submit (server recomputes; they must match — e.g. `meal_days:3,nights:2,transfer:true,uniform{qty:1}` → **RM 440.00**).
- [ ] Queue rows (B2.1): **selections chips** (🍚N天 🏨N晚 🚐 👕size×qty 🎁×N), **费用 clickable → expands the fee breakdown**, member name **links to the member profile**, and (once decided) the **decider name + date** show.
- [ ] Queue: **✓批准** → row flips 已批准 (event reloads; capacity→full reflected if reached). **✗拒绝** → modal, **reason required** (empty → blocked), then 已拒绝. **取消** (pending/approved) → confirm → 已取消.
- [ ] **导出 CSV** downloads `<code>-报名-<tab>-<date>.csv` and opens in Excel with **Chinese intact** (UTF-8 BOM); columns: 报名编号 · 姓名 · 中心 · 组 · 选项 · 费用 · 状态 · 处理人 · 处理日期.
- [ ] Status matrix enforced by the buttons: invalid transitions are simply **not rendered** (e.g. no 发布 on a completed event; server also 400s if forced).

## erp_admin (Kai Shin — now TWO doors)
- [ ] **Expected change:** she now holds `members` + `events`, so `visibleModules` = 2 → **login lands on `/dashboard/home`** (the multi-door hub), **not** straight into members. Rail shows 会员 + 活动 + **⌂ 主页**.
- [ ] Full events capability (create/edit/publish/代报名/decide) — same as admin within events.
- [ ] Still **zero care**: `/dashboard` routes her away; care API 403; care REST → `[]`.

## care volunteer — nothing changed
- [ ] No **活动** door, no ⌂ 主页 (single-door).
- [ ] Direct `/dashboard/events` → **此页面需要活动模块权限** notice; the API already 403s.
- [ ] Inbox/reply flow unchanged.

## §6 rider (carried from 08 — role dropdown)
- [ ] 设置 → 账号管理 → 编辑 a test account → change 角色 via the dropdown (disabled on your own row) → badge + scope badge update → `audit_log` `settings/update/volunteers` row.

## Test-data decision
- [ ] Keep XLFM-2608 / 2608B (+ 3 regs) as demo data **or** clean via status transitions (关闭报名 → 标记结束; cancel the regs). **No delete exists** — record Ken's choice here: ____________________________

---

## B2.1 — read-response completion (folded into the checks above)
The two read endpoints were extended so the UI renders the full mockup (no new routes):
- **`GET /events` (list)** now returns each event's `fees` → the overview **fee-summary line**.
- **`GET /events/[id]/registrations`** now returns `selections`, `fee_breakdown`, `member_id`,
  and the joined `decider` (display_name/email) → the queue's **selections chips**, **breakdown
  expand**, **member-profile link**, **decider name+time**, and the CSV **选项 / 处理人** columns.
Both use batched/joined queries (no N+1). The 代报名 live preview already matched the server total.
