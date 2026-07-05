# A6 — ERP account issuance + two-wing verification (Phase A close-out)

A6 makes ERP roles issuable (admin-only), scope-derived, and fully audited. This is the
**closing checklist for Phase A**: prove that a real ERP account can be created and that the
two wings are genuinely separated (an ERP admin cannot read care data via the app OR the DB).

Run after deploy. Tick each box and jot results/notes on the lines. Audit inspection SQL
(run in the Supabase SQL Editor):
```sql
select id, at, actor_email, module, action, table_name, record_id, before, after
  from audit_log order by id desc limit 20;
```

Roles today: `admin` (Ken) · `volunteer` (care) · **`erp_admin`** (new) · `committee` (unused).
`scopeForRole`: only `volunteer` → `own_center`; every other role → `all_centers`.

---

## A. Creation (Ken, admin)
Create the first ERP account via **设置 → 账号管理 → 添加义工**:
- email `natalie.tkt@gmail.com` · 显示名称 `Kai Shin` · 角色 **ERP 管理员** · initial password (≥8).
- With 角色 = ERP 管理员, the centre fields are **hidden** and the hint shows *「ERP 管理员：可管理会员/活动/财务等模块，无法读取关怀对话。」*

- [ ] Account created (201); appears in the account list.
- [ ] List row shows role badge **ERP 管理员** + scope badge **全部中心**.
- [ ] `audit_log` has a fresh row: `module='settings'`, `action='create'`, `table_name='volunteers'`, `record_id` = her id, `actor_email` = **Ken's** email, `after` = `{email, display_name:'Kai Shin', role:'erp_admin', scope:'all_centers', centre_id:null}`.

Notes: __________________________________________________________________

## B. Kai Shin's first login
- [ ] Login → **forced password-change gate fires** (must_change_password); she sets a new password.
- [ ] After the gate she lands **directly on `/dashboard/members`** — `visibleModules` = `['members']`, so login routes straight in: **no hub, no `⌂ 主页`** in the rail.
- [ ] The rail shows **only 会员** (no 收件箱 / 报表 / 设置).

Notes: __________________________________________________________________

## C. Two-wing proof (the Phase A promise)
### C1 — Kai Shin's app session (care is closed to her)
- [ ] `GET /api/dashboard/conversations` → **403** (`{"error":"Forbidden"}`).
- [ ] Navigating to `/dashboard` → **routed away to `/dashboard/members`** (no care view → not the inbox).
- [ ] `/dashboard/reports` and `/dashboard/settings` → the admin-only notice / denied (she is not admin).

### C2 — REST / RLS probe with HER user JWT (per `docs/erp/01-a2-verification.md` Part A)
Get her `access_token` (sign-in as her, or mint one), then:
```bash
for t in contacts conversations messages; do
  printf "%s: " "$t"
  curl -s "https://$PROJECT_REF.supabase.co/rest/v1/$t?select=id&limit=3" \
    -H "apikey: $SUPABASE_ANON_KEY" -H "Authorization: Bearer $KAISHIN_JWT"
  echo
done
curl -s "https://$PROJECT_REF.supabase.co/rest/v1/members?select=id&limit=3" \
  -H "apikey: $SUPABASE_ANON_KEY" -H "Authorization: Bearer $KAISHIN_JWT"
```
- [ ] `contacts` / `conversations` / `messages` → **200 with `[]`** (RLS: no care grant → zero rows).
- [ ] `members` → **200 with rows** (has `members` grant; `all_centers` scope passes).

### C3 — a care volunteer is unchanged
- [ ] Care volunteer login → inbox works exactly as before (list, open conversation, takeover + reply).
- [ ] Same volunteer visiting `/dashboard/members` → **403** (no members grant).

### C4 — members CRUD as Kai Shin carries HER identity
- [ ] Kai Shin creates a member → `audit_log` `create` on `members` with `actor_email` = **her** email.
- [ ] Kai Shin edits that member → `audit_log` `update` on `members` (changed fields only) with `actor_email` = **her** email.

Notes: __________________________________________________________________

## D. Account audit (Ken reviews every account)
In **设置 → 账号管理**, review the full list. There are currently **TWO admin-tier accounts** —
identify the second one.
- [ ] Second admin-tier account identified: __________________________________
- [ ] Decision: keep / deactivate (circle one). If it should not exist, **停用** it — this now
      writes an `audit_log` row: `action='deactivate'`, `table_name='volunteers'`, `actor_email` = Ken.
- [ ] Confirm the deactivate audit row is present (if deactivated).

Notes: __________________________________________________________________

## E. Sign-off
- [ ] All boxes above ticked; two-wing separation confirmed at BOTH layers (app routes + RLS).
- [ ] Phase A complete.

Reviewer: ______________________   Date: ______________

---

### Reference — audit actions emitted by the account routes (A6)
| Event | module | action | table_name | payload |
|---|---|---|---|---|
| Create account | settings | `create` | volunteers | after = {email, display_name, role, scope, centre_id} |
| Edit fields (name/email/center/centre_id/role) | settings | `update` | volunteers | before/after = changed fields only |
| Toggle active off / on | settings | `deactivate` / `reactivate` | volunteers | before/after = {active} |

Scope is **never** taken from the client — it is derived from the role on both create and role-change
(`volunteer` → `own_center`, else `all_centers`). `centre_id` is validated against `centres` when provided.
