# C2 — public registration UI + staff publish/QR: verification

Covers the C2 front-end over the C1 anonymous API (**no new API routes, no new migration**):
the public mobile flow at `/r/[token]`, the status-lookup page at `/r/[token]/status`, and the
staff **公开报名** publish/QR affordance on the event detail page.

> No deploy-order dependency of its own — C1 (migration 018 + the `/api/public/**` routes) is
> already live. C2 is UI only; just deploy the code.

**⚠️ PLACEHOLDERS that 理事会 must finalise before real launch** (all clearly marked in the UI):
- **PDPA / consent** one-liner in the `/r` footer (`src/app/r/[token]/layout.tsx`).
- **Payment** — bank name / account / QR image on the confirm step (`PaymentCard`). Currently
  a dashed "收款 QR（待理事会提供）" box + blank account lines.

---

## Setup (staff, logged in as an events:edit user — Ken / Kai Tsin)

1. Open an **open** event with `per_item` meals — **XLFM-2608** (B2/C0 test data).
2. On the detail page, find the **🔗 公开报名 Public form** card (below 费率 / 团队需求).
3. Flip the toggle **on** → toast 「公开报名已开启」. The card now shows: the public URL
   (`<origin>/r/<token>`), a **复制链接** button, an **在新分页打开表单 ↗** link, and a **QR code**.
   - [ ] Toggle **off** then **on** again → **same URL/token** (reuse, not regenerated).
   - [ ] **复制链接** copies the URL (toast 「链接已复制」).
   - [ ] **Scan the QR with a real phone camera** → it opens the same `/r/<token>` URL. (A QR is
     only truly valid when a device scans it — do this on an actual phone.)
   - [ ] Non-events:edit staff (care volunteer) never sees this card (it's `canEdit`-gated; the
     server PATCH is also events:edit-gated).

Copy the `/r/<token>` URL for the mobile tests below. **Do all `/r` tests LOGGED OUT** (incognito
or a phone), at ~360px width.

---

## Public flow — `/r/[token]` (logged out, narrow / phone)

### Shell
- [ ] Warm standalone page: 🪷 心灵法门马来西亚 wordmark header, centered ≤460px column, PDPA
  placeholder footer. **No** dashboard nav, **no** login redirect, **no** ERP chrome.
- [ ] A 4-dot step indicator sits at the top.

### Step 1 — identify
- [ ] Event header shows title, type badge, centre name, dates, and 报名截止 (if set).
- [ ] **老同修 (matched):** enter 测试会员's phone → 下一步 → green card
  「✓ 找到您了：测＊＊ · <中心>」 with **这是我，继续** and a **不是我？** link. No full name / no id shown.
- [ ] **这是我，继续** proceeds as matched (phone is the key — no name asked).
- [ ] **不是我？** falls through to the newcomer fields.
- [ ] **Newcomer:** a random phone → 中文姓名* + 英文姓名(选填) fields (no 中心 field — see design
  note). Empty 中文姓名 + 下一步 → inline 「请填写中文姓名」.
- [ ] Malformed phone → the server's Chinese error surfaces.

### Step 2 — selections (only enabled fee items render)
- [ ] **Meal (per_item):** a grid of dates × 早/午/晚 shows **only offered cells** (un-offered
  cells are a dim「—」, not tappable). Tap toggles gold; **全选 / 清空** and a per-day date label
  (整天) work; a live 「已选 N 餐」 count updates.
- [ ] Meal (per_day legacy event): a 用餐天数 stepper instead of the grid.
- [ ] 住宿 → 晚数 stepper; 机场接送 → checkbox; 制服 → size select + 数量; 报名费 → auto-included
  note; 结缘品/其他 → 数量. Items **not** enabled on the event do **not** appear.
- [ ] A **sticky bottom bar** shows the live 合计 that changes as selections change.
- [ ] 上一步 returns to step 1 with entries preserved.

### Step 3 — confirm + pay
- [ ] Itemised breakdown (label ×qty → subtotal) + 合计 Total, computed client-side.
- [ ] 缴费说明 card renders the **PLACEHOLDER** bank lines + dashed QR box + 「转账后请保留收据…」.
- [ ] **确认报名** → submits. On a duplicate → inline 「您已报名此活动（编号 XLFM-2608-＊＊＊＊）」
  (masked). On a validation error → the server's Chinese message.

### Step 4 — done
- [ ] 🪷 「报名已提交」, the **reg_no** in a monospace pill, a **待审核 Pending** badge, the line
  「凭编号 + 手机号可查询状态 / 修改用餐（活动开始前 N 天截止）」, and a **查询我的报名** button.

### Cross-check the submission
- [ ] **Live fee = stored fee:** the 合计 shown in steps 2/3 equals the `fee_total` the staff queue
  shows for the new registration (server recomputes and snapshots — they must match).
- [ ] The new reg appears in the **staff 报名 queue** as `待审核`: matched → member-linked;
  newcomer → applicant name, no member link, **and no new member row was created** (`建档` happens
  on staff approval).

### Invalid links
- [ ] A **disabled** form (toggle off), a **closed/full** event, and a **garbage** token
  (`/r/xxxxxxxx`) each show the warm 「报名已关闭或链接无效 🙏」 card — never a stack trace, never
  event data.

---

## Status lookup — `/r/[token]/status`
- [ ] reg_no + phone of a real submission → status badge, event title/dates, 费用合计, and a
  selections summary. A note 「如需修改，请联系活动负责人。」 (no public editing — by design).
- [ ] Wrong phone or unknown reg_no → warm 「找不到，请确认编号与手机号 🙏」.
- [ ] The **查询我的报名** button on step 4 lands here.

---

## Design notes recorded in code (for the review)
- **Newcomer 中心 omitted:** the public event JSON exposes only its own organizing centre (not the
  full list), and C1 `register` validates `centre_id` against real centres — a public visitor has no
  centre picker, so we send no `centre_id` and let the approver assign the centre at `建档`.
- **义工组 omitted from the public form:** teams aren't in the public JSON; volunteer-team
  assignment stays a staff action.
- **No public editing:** C1 has no public selections-edit route (only staff `修改选项`); the status
  page states this rather than offering an edit that can't exist.
- **QR is dependency-free:** rendered client-side from `src/lib/qr.ts` (a vendored port of the
  standard QR algorithm) as inline SVG — **no npm dependency added**. Confirm by phone scan.
