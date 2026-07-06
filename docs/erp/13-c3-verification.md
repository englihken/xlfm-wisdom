# C3 — payment tracking + optional proof upload: verification (migration 019)

Covers `migrations/019_payment_tracking.sql` (the six `registrations.payment_*` columns + the
PRIVATE `payment-proofs` Storage bucket), the anonymous proof-upload route, the staff
signed-URL viewer + payment actions, and the gentle public/staff payment UI.

> **DEPLOY ORDER — apply 019 FIRST, then push.** The routes read the new columns and the
> `payment-proofs` bucket; deploying code first would break the events GET / registrations
> list (unknown column) and the upload route (missing bucket).

**Guiding ethos to keep in mind while testing:** payment is **entirely optional and never
coercive**. It must **never** gate registration or approval. `已豁免` is guilt-free. No
overdue / red-alarm styling anywhere.

**⚠️ Remaining 理事会 PLACEHOLDERS** (unchanged from C2, still marked in the UI): the payment
**QR / bank details** on the confirm + pay-now cards, and the **PDPA** footer line.

---

## PREFLIGHT — before applying 019 (STOP on deviation)

```sql
-- (1) the payment columns do NOT exist yet — expect 0 rows
select column_name from information_schema.columns
 where table_schema='public' and table_name='registrations'
   and column_name in ('payment_status','payment_proof_path','paid_amount','payment_note','payment_verified_by','payment_verified_at');

-- (2) the bucket does NOT exist yet — expect 0 rows
select id from storage.buckets where id='payment-proofs';

-- (3) registrations exists (016) — expect one real regclass
select to_regclass('public.registrations');
```
**Expect — STOP if different:** (1) 0 rows · (2) 0 rows · (3) `registrations`.

---

## VERIFY — after applying 019

```sql
-- (1) all six columns exist; payment_status is NOT NULL default 'unpaid'
select column_name, data_type, is_nullable, column_default
  from information_schema.columns
 where table_schema='public' and table_name='registrations'
   and column_name like 'payment%' or column_name in ('paid_amount')
 order by column_name;

-- (2) the payment_status CHECK allows exactly the four states
select pg_get_constraintdef(oid) from pg_constraint
 where conrelid='public.registrations'::regclass and contype='c'
   and pg_get_constraintdef(oid) ilike '%payment_status%';

-- (3) the bucket exists and is PRIVATE
select id, name, public from storage.buckets where id='payment-proofs';

-- (4) NO anon/authenticated storage policy references this bucket (service-role only)
select polname, polcmd, pg_get_expr(polqual, polrelid) as using_expr
  from pg_policy where polrelid='storage.objects'::regclass;
```
**Expect:**
| # | Expectation |
|---|---|
| (1) | 6 columns; `payment_status` `NOT NULL` default `'unpaid'`; `paid_amount` numeric nullable; others nullable. |
| (2) | `CHECK ((payment_status = ANY (ARRAY['unpaid','proof_submitted','verified','waived'])))`. |
| (3) | one row, `public = false`. |
| (4) | **No policy** whose qual/name targets `payment-proofs` for anon/authenticated. (Any pre-existing storage policies for OTHER buckets are fine — just none opening this one.) |

**Bucket-is-private smoke test:** a direct public object URL must NOT resolve:
`https://<project>.supabase.co/storage/v1/object/public/payment-proofs/anything` → **400/404**
(never 200). Objects are reachable ONLY via a server-minted signed URL.

---

## Public flow — `/r/[token]` (logged out)

### Register → done (the pay-now/later/never loop)
- [ ] Register as usual → **done** step still shows reg_no + 待审核. Below it, when fee > 0:
  「费用 RM X · 随喜发心，可现在付款、日后补上，或到场再说 🙏」 with **我现在付款** and a disabled
  **我稍后再说** (already registered — choosing "later" does nothing, never blocks).
- [ ] **我现在付款** reveals the 缴费 PLACEHOLDER card + **上传付款证明（可选）** picker.
- [ ] Upload a **receipt image** → 「✓ 付款凭证已上传，感恩护持 🙏」. (In the staff queue the reg now
  shows **已提交凭证**.)
- [ ] Confirm step (step 3) also shows the gentle 随喜发心 payment section — never a blocker.

### File validation (upload)
- [ ] A **non-image/pdf** (e.g. `.txt`) → 400「仅支持图片…或 PDF」.
- [ ] A file **> 5MB** → 400「文件过大（上限 5MB）」.
- [ ] Upload works for jpg / png / webp / heic / pdf.

### Status page — `/r/[token]/status`
- [ ] Look up with reg_no + phone → a gentle **payment badge** (未付款 grey / 已提交凭证 gold /
  已核实 green / 已豁免 lavender) beside the fee, plus an **上传付款证明（可选）** uploader (re-upload
  refreshes the badge). Still states 用餐修改需联系负责人.
- [ ] **Wrong reg_no or wrong phone on upload → 404** (ownership proof; no enumeration). Same for
  a cross-origin POST (same-origin gate → 404).

---

## Staff — event detail queue (events:edit)

### Decoupling (the important one)
- [ ] **Approve a registration whose payment is still 未付款** → approval succeeds. Payment and
  approval are independent tracks; nothing about payment blocks the approve/reject controls.

### Payment badge + panel
- [ ] Each row shows a payment badge independent of its 报名 status; verified rows show the amount.
- [ ] **付款** opens the panel. If a receipt exists, it renders via a **signed URL** (image inline,
  or a "打开 PDF ↗（60 秒内有效）" link). No receipt → a gentle "可现场核对，无需凭证即可核实".
- [ ] **核实付款**: paid_amount defaults to the fee (editable), optional note → status 已核实,
  `payment_verified_by/at` set. An `audit_log` row (module 'events', before/after payment fields).
- [ ] **标记豁免** on another reg (optional note e.g. `HQ 决定豁免`) → 已豁免, paid_amount 0, audited.
- [ ] **撤销** on a verified/waived reg → returns to 已提交凭证 (if a receipt is on file) else 未付款;
  clears amount/verifier/note; audited.
- [ ] The signed URL **expires** (~60s) — reopening the panel re-mints a fresh one.

### Header stat (gentle, no target)
- [ ] The capacity card shows 「已收款 RM x · 已核实 N · 已豁免 M · 待核实 K · 随喜发心，不设指标」.
  No overdue count, no red, no shaming.

### End-to-end
- [ ] A **public** proof upload (from `/r/.../status`) lands on the **correct** registration and the
  staff panel shows that exact image via the signed URL.

---

## Security recap (the review points)
- `/api/public/registrations/proof` is anonymous but gated by **ownership** (reg_no + matching
  phone) + same-origin + rate limit + type/size caps; it uploads via **service-role** to a
  **private** bucket at a **randomised** path (client filename never trusted) and **never demotes** a
  staff-set verified/waived status.
- Staff read receipts ONLY through the events:view **signed-URL** route (~60s TTL); the raw path is
  never exposed and the bucket is never world-readable.
- The anon Postgres role is never used anywhere in this surface.
