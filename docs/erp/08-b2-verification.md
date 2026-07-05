# B2 — events / registrations API: verification

API-only phase (no events UI — that's B3). Run these against production once deployed,
from the **logged-in browser console** as an account holding `events:edit` (admin or
erp_admin) — the house method:
```js
const j = (r) => r.json();
const post = (u, b) => fetch(u, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(b) }).then(async r => ({ status:r.status, body: await j(r) }));
const patch = (u, b) => fetch(u, { method:'PATCH', headers:{'Content-Type':'application/json'}, body: JSON.stringify(b) }).then(async r => ({ status:r.status, body: await j(r) }));
const get = (u) => fetch(u).then(async r => ({ status:r.status, body: await j(r) }));
```
You'll need a centre id and the test member id:
```js
const meta = await get('/api/dashboard/erp/meta');           // meta.body.centres[0].id, .teams[...]
const members = await get('/api/dashboard/members?search=测试会员'); // members.body.members[0].id
```

---

## 1. Create a draft event with the mockup's fees + a team need
```js
const centre = meta.body.centres[0].id;
const team   = meta.body.teams[0].id;
const ev = await post('/api/dashboard/events', {
  title: '测试法会', event_type: 'fahui', organizing_centre_id: centre,
  starts_on: '2026-08-15', ends_on: '2026-08-17', capacity: 100, requires_approval: true,
  fees: [
    { item:'meal',          amount:30,  billing:'per_day'   },
    { item:'accommodation', amount:120, billing:'per_night' },
    { item:'transfer',      amount:80,  billing:'per_person'},
    { item:'uniform',       amount:30,  billing:'per_item'  },
  ],
  team_needs: [ { team_id: team, needed: 5 } ],
});
```
- [ ] `ev.status === 201`; `ev.body.event.code === 'XLFM-2608'` (YYMM of 2026-08); `status === 'draft'` (client status ignored).
- [ ] `ev.body.event.fees` has 4 items; `team_needs` has 1.
- [ ] Wrong billing rejected: `post(... fees:[{item:'meal',amount:30,billing:'per_person'}] )` → **400** (`meal` must be `per_day`).
- [ ] `audit_log`: `module='events' action='create' table_name='events'`, actor = you, `after` includes the fees + team_needs.

Keep `const eventId = ev.body.event.id;`

## 2. Open it (status machine)
```js
await post(`/api/dashboard/events/${eventId}/status`, { status:'open' });     // draft→open ✓
```
- [ ] 200; event status now `open`.
- [ ] Invalid transition: `post(.../status, { status:'completed' })` from `draft` on a **fresh** draft event → **400** with `allowed:['open']`. (For this event it's already open; test on a second draft, or note draft→completed is blocked.)

## 3. Register 测试会员 — fee engine must produce RM 440.00
```js
const reg = await post(`/api/dashboard/events/${eventId}/registrations`, {
  member_id: members.body.members[0].id,
  selections: { meal_days:3, nights:2, transfer:true, uniform:{ size:'M', qty:1 } },
});
```
- [ ] 201; `reg.body.registration.fee_total === 440` (30×3 + 120×2 + 80×1 + 30×1).
- [ ] `fee_breakdown` has **4 lines** (meal/accommodation/transfer/uniform), each with `qty` + `subtotal`; snapshot stored on the row.
- [ ] `reg_no === 'XLFM-2608-0001'`; `status === 'pending'` (event `requires_approval`).
- [ ] `audit_log`: `action='create' table_name='registrations'`, actor = you, `after` carries `reg_no` + `fee_total` + `fee_breakdown`.

Keep `const regId = reg.body.registration.id;`

## 4. Decisions
```js
await post(`/api/dashboard/registrations/${regId}/decision`, { decision:'approve' });
```
- [ ] 200; registration `approved`; `decided_by` = your volunteer id, `decided_at` set; `audit_log` update row (before `pending` → after `approved`).
- [ ] Reject needs a reason — register a 2nd member, then:
      `decision:{decision:'reject'}` → **400** (请填写拒绝原因); `{decision:'reject',reason:'名额已满'}` → 200, `rejected`.
- [ ] Duplicate: POST a registration for the **same** member again → **409** with `existing.reg_no`.

## 5. Capacity → auto-full
```js
// second event with capacity 1
const cap = await post('/api/dashboard/events', { title:'小型共修', event_type:'gongxiu', organizing_centre_id: centre, starts_on:'2026-08-20', capacity:1, requires_approval:true, fees:[], team_needs:[] });
await post(`/api/dashboard/events/${cap.body.event.id}/status`, { status:'open' });
const r2 = await post(`/api/dashboard/events/${cap.body.event.id}/registrations`, { member_id: members.body.members[0].id, selections:{} });
await post(`/api/dashboard/registrations/${r2.body.registration.id}/decision`, { decision:'approve' });
```
- [ ] Approving the 1st registration flips the event `open → full` automatically.
- [ ] **Two** `audit_log` rows: the registration `update` (→approved) **and** an events `update` with `after` = `{status:'full', note:'capacity reached'}`.

## 6. Settings rider (A6 — role dropdown on the edit form)
In **设置 → 账号管理**, click **编辑** on a test account (not your own row — your own role dropdown is **disabled** with 「不能修改自己的角色」).
- [ ] Change 角色 to **理事会** (or any) → 保存 → row badge updates; scope badge re-derives (all_centers for admin-tier, 本中心 for 关怀义工).
- [ ] `audit_log`: `module='settings' action='update' table_name='volunteers'` with `before/after` containing `role` (and `scope` if it changed), actor = you. (Routes through the same PATCH as before.)

## Expected audit_log tail (most recent last), after running §1–§6 in order
```sql
select at, actor_email, module, action, table_name, record_id, after
  from audit_log order by id desc limit 12;
```
Roughly (newest first): `settings/update/volunteers` (role change) · `events/update/events` (capacity→full)
· `events/update/registrations` (r2 approved) · `events/create/registrations` (r2) · `events/create/events`
(小型共修) · `events/update/registrations` (2nd member rejected) · `events/create/registrations` (2nd member)
· `events/update/registrations` (0001 approved) · `events/create/registrations` (0001) · `events/update/events`
(open) · `events/create/events` (测试法会). All `actor_email` = you.

---

**B3 will add** the events UI (活动 door in `visibleModules` + its pages: events list/create/edit,
event detail with fees & team-needs editors, and a registrations tab driving these routes). No new
API is expected for B3 beyond what B2 provides here.
