# A4 — Members module: manual verification

Run after deploy. A4 adds the 会员 module (API + UI + nav + audit writers) gated on the
`members` grant from 013. Full cross-role probing (erp_admin / committee) lands in **A6**,
once those accounts exist — this pass covers what's testable with today's accounts
(`admin` = Ken, and any `volunteer`).

## Roles available today
| role | members grant | expects |
|---|---|---|
| `admin` | `admin` | sees 会员 nav, full CRUD |
| `volunteer` | none | NO 会员 nav, 403 on the API + page |
| `erp_admin` | `admin` (no care) | **A6** — account doesn't exist yet; will land on /dashboard/members and have full CRUD, zero care access |
| `committee` | `summary` (< view) | **A6** — no member rows (summary < view); aggregate views come in Phase D/F |

---

## 1. Nav + landing (admin)
- Log in as **admin**. The left rail shows **会员** (people icon) between 收件箱 and 报表. Inbox, 报表, 设置 are **unchanged**.
- Open `/dashboard` → the care inbox loads exactly as before (admin has care access, so **no** redirect).
- Click 会员 → `/dashboard/members`.

## 2. Care volunteer is fully blocked
Log in as a **volunteer** (care-only):
- The rail shows **NO 会员** item (grant-gated).
- Visit `/dashboard/members` directly → the page shows the **此页面需要会员模块权限** notice (not the list).
- Hit the API directly → **403**:
  ```bash
  curl -s -o /dev/null -w "%{http_code}\n" "$APP_ORIGIN/api/dashboard/members" -H "Cookie: $VOLUNTEER_SESSION_COOKIE"
  # expect 403   (body {"error":"Forbidden"})
  ```
- Inbox / 报表 / 设置 behave exactly as before for this volunteer (zero change).

## 3. Create → Edit → Deactivate (admin) + audit trail
As **admin**, on `/dashboard/members`:

1. **Create** — click **+ 新增会员**. Fill 中文姓名 `测试会员`, 电话 `0123456789` (will normalize to `60123456789`), 中心 = 怡保 Ipoh, 弟子 = 是, 全素 = 否. Save → lands on the new profile. Confirm phone shows `60123456789`, centre badge `IPOH`, 弟子 badge present.
2. **Teams** — on the profile, 编辑组别 → tick 交通 as 组长, 膳食 as 组员 → 保存. Chips update (交通 · 组长 highlighted).
3. **Edit** — 编辑 → change 职业 to `教师` → 保存修改 → profile reflects it.
4. **Deactivate** — 停用 → confirm → status flips to 已停用. Re-open list with 状态 = 已停用 to see it; 启用 to restore.

Then inspect the audit trail (Supabase SQL Editor):
```sql
select id, at, actor_email, module, action, table_name, record_id, before, after
  from audit_log order by id desc limit 10;
```
**Expect** (most-recent first) rows for that member's `record_id`:
- `action='update'`, `table_name='member_teams'` (the teams PUT; before/after = the sets)
- `action='update'`, `table_name='members'` (the 职业 edit — **before/after contain only `occupation`**)
- `action='create'`, `table_name='members'` (after = full row)
- …and a `deactivate` (+ later `reactivate`) row for the status changes.

Each row's `actor_email` = the admin's email. (If audit ever fails it is `console.error`'d server-side but the mutation still succeeds — check server logs, not the user flow.)

## 4. Duplicate phone → 409 UX
As **admin**, create another member with the **same** phone (`0123456789` / `60123456789`):
- The form shows **该电话号码已存在** with a link **查看已有会员：测试会员** → clicking it opens the existing profile.
- API check:
  ```bash
  curl -s -X POST "$APP_ORIGIN/api/dashboard/members" -H "Content-Type: application/json" \
    -H "Cookie: $ADMIN_SESSION_COOKIE" -d '{"name_cn":"重复","phone":"60123456789"}'
  # expect HTTP 409, body { "error":"该电话号码已存在", "existing": { "id":"…","name":"测试会员" } }
  ```

## 5. Phone normalization + name guard (API)
```bash
# 0-prefixed normalizes to 60…
curl -s -X POST "$APP_ORIGIN/api/dashboard/members" -H "Content-Type: application/json" \
  -H "Cookie: $ADMIN_SESSION_COOKIE" -d '{"name_cn":"陈一","phone":"012-345 6789"}'
# → 201, stored phone "60123456789"

# ambiguous phone → 400 with the normalized attempt echoed
curl -s -X POST "$APP_ORIGIN/api/dashboard/members" -H "Content-Type: application/json" \
  -H "Cookie: $ADMIN_SESSION_COOKIE" -d '{"name_cn":"陈二","phone":"123"}'
# → 400  电话号码格式不正确（应为马来西亚号码，如 60123456789）：123

# no name → 400
curl -s -X POST "$APP_ORIGIN/api/dashboard/members" -H "Content-Type: application/json" \
  -H "Cookie: $ADMIN_SESSION_COOKIE" -d '{"phone":"60111111111"}'
# → 400  请至少填写中文或英文姓名
```

## 6. List filters + pagination (admin)
- Search 名字/电话 (300ms debounce), 中心 / 组别 / 弟子 / 全素 / 状态 selects each narrow the table; changing any filter resets to page 1.
- Pagination footer shows `第 x / y 页 · 共 N`; ‹ › move pages (25/page).
- With no members: the empty state reads *还没有会员 … 通过导入（A5）… 或「+ 新增会员」*.

## 7. No delete anywhere
Confirm there is **no** delete button on the list or profile, and no DELETE route exists under
`/api/dashboard/members/*` (deactivate-not-delete). `members` and `member_teams` history is
preserved.

## A6 (later) — cross-wing probe once erp_admin/committee accounts exist
- `erp_admin`: logs in → auto-redirected from `/dashboard` to `/dashboard/members`; full member CRUD; **zero** care access (care inbox/reports API → 403; care tables via PostgREST → `[]`).
- `committee`: `members:summary` < `view` → member list API 403 and no rows via RLS; aggregate/summary views arrive in Phase D/F.
- Re-run the §2 403 checks and the §3 audit inspection per role.
