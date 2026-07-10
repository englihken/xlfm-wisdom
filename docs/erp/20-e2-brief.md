# XLFM ERP — E2 施工 brief · 共修会事务信箱 (in-system inbox, plumbing A)

**For: Claude Code (repo at origin/main 6ef6cf5).** Architect has already applied migration `030_inbox_foundation` to the live DB via connector — the schema below EXISTS in production. Your job: app code only. Follow existing repo conventions (route handlers, service-role Supabase client, auth/session pattern, audit helper, dashboard layout/nav, Chinese UI strings). Where this brief names a file that doesn't match repo reality, follow the repo's actual structure and keep the behavior contract.

## 0. Context (1 paragraph)
E1 (渡人) is fully shipped. E2 adds the second inbox family from the Phase E mockup tab ②: per-centre 共修会事务信箱 (Outlook-style 3-pane), a public write-in form, 内部往来 internal mail, plus settings sections 收件箱配置 / 共修会管理 / 通知与模板, and the new role 分会负责人 (`centre_head`). Ken chose plumbing **A: in-system only** — no email send/receive in E2 (Gmail auto-forward ingest = E2b, later). 智慧问答 keeps its existing dedicated care panel untouched; the inbox rail only deep-links to it.

## 1. Governance ruling (locked — implement exactly)
「钱要透明，信要尊重」:
1. **Thread content is scoped to mailbox owners** (+ centre_head of that centre, + admin via break-glass only).
2. **HQ roles (erp_admin, committee) see health counts only** — 未处理 n · 最旧 x 天 · crisis n per mailbox. Never subjects-with-bodies, never message content.
3. **Escalation, not surveillance**: unhandled > `remind_centre_days` (default 7) → owner-side highlight/banner; > `surface_hq_days` (default 14) → thread surfaces on HQ health page as subject + age ONLY. Both values from `org_settings key='inbox.escalation'`, editable in 收件箱配置. Computed on read — no cron.
4. **Crisis auto-escalates immediately, stated openly**: on public form submit, scan subject+body for `org_settings key='inbox.crisis_keywords'` (case-insensitive substring). Match → `crisis_flag=true`; thread appears at once in a national 危机 strip visible to admin + care volunteers (module care ≥ edit) regardless of centre wall. The public form page carries the line: 「涉及危机的来信，系统会即刻转给全国关怀组跟进。」
5. **Break-glass 代管 (admin only)**: admin can open any mailbox, but UI must show a confirm dialog (「代管查看会记入审计日志」) and write `audit_log` module='inbox' action='break_glass_view' (record_id=mailbox_id, after={mailbox, centre}) BEFORE rendering content. Every subsequent admin action in that mailbox audits as usual.
6. **内部往来 shared**: internal threads visible to BOTH sides (sender centre + recipient mailbox). 智慧问答 stays national in its own panel.

## 2. DB state (already applied — migration 030_inbox_foundation)
Copy the migration file into the repo as `migrations/030_inbox_foundation.sql` (full SQL at the bottom of this brief). Summary:
- `inbox_mailboxes` — one row per centre (36 seeded; trigger `centres_auto_mailbox` auto-creates for new centres). `is_enabled` (HQ=true, rest false), `auto_reply_enabled`, `auto_reply_text`.
- `inbox_mailbox_owners` — (mailbox_id, volunteer_id, added_by). Ownership = content access, independent of role.
- `inbox_threads` — mailbox_id, kind 'form'|'internal', from_centre_id (required for internal), subject, sender_name/phone/email, status 'new'|'in_progress'|'replied'|'archived', assigned_to, contact_id, linked_module/linked_record_id/linked_label, crisis_flag, first_response_at, last_message_at, created_by.
- `inbox_messages` — thread_id, direction 'inbound'|'outbound'|'note', body, author_id, author_name.
- `message_templates` — module='inbox' reply templates (3 seeded).
- `org_settings` — key/jsonb: `inbox.escalation` {remind_centre_days:7, surface_hq_days:14}, `inbox.crisis_keywords` [..].
- `contacts` gained `notify_opt_in` bool, `notify_opt_in_at`, `notify_opt_in_note` (opt-in WhatsApp notify list).
- role_grants: module **'inbox'** → admin=admin, erp_admin=summary, committee=summary, centre_head=edit. New role **centre_head** (分会负责人) also got members/events/inventory/outreach = edit. centre_head accounts use existing volunteers.scope='own_center' + centre_id.
- RLS: thread/message SELECT gated by security-definer `can_read_inbox_thread(uuid)`; app server keeps using service role + app-level walls as everywhere else.
- Check constraints extended: `role_grants_module_check` now includes 'inbox' (and 'reports' was already allowed — E3 ready); `volunteers_role_check` now includes 'centre_head'. If the app has a hardcoded role/module list (types, zod enums, role dropdown), extend it to match.

## 3. Scoping module — `src/lib/inbox-scope.ts` (mirror outreach-scope.ts style)
Export a resolver used by every inbox API:
- `getInboxAccess(user)` → `{ level: 'admin'|'summary'|'edit'|'owner-only'|'none', mailboxIds: uuid[], centreId?: uuid }`
  - admin (role_grants inbox=admin): level 'admin' — all mailboxes, but content endpoints require `breakGlass=true` flag handled per §1.5.
  - inbox=edit + scope own_center (centre_head): own centre's mailbox only.
  - inbox=summary (erp_admin/committee): health endpoints only, zero content endpoints.
  - any volunteer with rows in inbox_mailbox_owners: those mailboxes (content), regardless of role. (关怀义工 etc. get nothing unless they own a mailbox.)
- Thread visibility must ALSO include internal-thread sender side: user's mailboxes' centres matched against `from_centre_id`.
- Uniform **404** (not 403) for cross-wall access — same convention as the E1b outreach wall.
- Nav gate: show 收件箱 nav item if level ≠ 'none'.

## 4. API endpoints (service role + wall checks; all mutations audit)
Under `src/app/api/inbox/`:
- `GET /api/inbox/meta` — visible mailboxes (id, centre name, is_enabled, owners[], counts: new_n, in_progress_n, crisis_n) + escalation config + my level. For summary level: all enabled mailboxes with counts + oldest_unhandled_days + owners, NO thread lists.
- `GET /api/inbox/threads?mailbox=…&status=…&folder=internal` — list for one visible mailbox (or internal folder across my centres). Fields: subject, sender_name, status, crisis_flag, assigned name, last_message_at, snippet (first 80 chars of latest message), kind, linked_label, contact_id. Escalation ages included (server-computed `age_days`, `overdue: 'remind'|'surface'|null`).
- `GET /api/inbox/threads/[id]` — thread + messages. Wall via can-read logic; admin without ownership → requires `?breakglass=1` AND writes break_glass_view audit first (once per mailbox per session is fine; simplest: audit every breakglass thread open).
- `POST /api/inbox/threads/[id]/messages` — body {direction:'outbound'|'note', body}. outbound: stamp thread.first_response_at if null, status 'new'→'in_progress' (auto), last_message_at=now. Audit action='replied' or 'note_added'.
- `PATCH /api/inbox/threads/[id]` — {status?|assigned_to?|mailbox_id?(transfer)|linked_*?|contact_id?}. Rules: assigned_to must be an owner of the thread's mailbox (or null); transfer allowed for owners/admin, appends a system note `已转给 {centre} 信箱` and audits 'transferred'; status change audits 'status_changed'; manual 'replied' allowed without outbound message.
- `POST /api/inbox/threads` — internal compose: {to_mailbox_id, subject, body, linked_module?, linked_record_id?, linked_label?}. from_centre_id = my centre (admin/national picks; default HQ). kind='internal', inbound message row with author=me. Audit 'thread_created'.
- `POST /api/inbox/threads/[id]/outreach` — 加入渡人名单: reuse the EXISTING persons-create path (same as E1b registration bridge): channel='manual' + explicit first_contact milestone (029 decision: form-born contacts DO NOT rely on the chat trigger; its note text is chat-specific). Set source_type='form', source_note=subject, display_name=sender_name, phone=sender_phone, centre_id = mailbox's centre. Store returned contact id on thread.contact_id. Idempotent: if thread.contact_id already set → 409 with existing link. Audit module='outreach' as the existing path does.
- `GET /api/inbox/health` — summary-level payload (also powers admin overview): per enabled mailbox {centre, owners, new_n, oldest_unhandled_days, crisis_n, surfaced:[{id, subject, age_days}] (only >surface_hq_days, subject+age only)}.
- Crisis strip: `GET /api/inbox/crisis` — threads crisis_flag=true & status not 'archived' (id, subject, mailbox centre, age). Access: admin OR care≥edit.

Public (no auth) under `src/app/api/public/inbox/route.ts`:
- `POST` — {centre_code?, name, phone, email?, subject, body, website?(honeypot)}. Validate: honeypot empty; phone required (MY format loose); rate limit per IP and per phone: 5/day (in-memory + DB count fallback is fine). Route: centre_code → that centre's ENABLED mailbox, else HQ mailbox. Create thread (kind='form', status 'new', sender_* filled) + inbound message. Crisis scan per §1.4. Return {ok, auto_reply_text?} (auto_reply shown on-screen only — no email in plumbing A). Audit action='thread_created' with actor_email='public-form'.

## 5. UI
Visual reference for every screen in this brief: project doc **claude/e2-inbox-ui-mockup.html** (5-tab clickable preview in the live app's skin). Follow the existing app's components/tokens, not the older phase-e mockup styling. Nav naming + order (Ken decision 2026-07-10): sequence **主页 → 收件箱 → 智慧问答 → 渡人 → 会员 → 活动 → 库存 → 财务 → 报表 → 设置**. The care module's nav label renames **收件箱 → 智慧问答** (chat-bubble icon; label-only — keep existing routes and unread-badge logic; update in-page titles/breadcrumbs that say 收件箱). The freed name **收件箱** goes to the NEW centre-mail module (mail icon, unread badge = my visible mailboxes' 未处理 sum; module header dept-style 共修会事务 · Mail). One name per thing; the mail rail's 智慧问答 entry matches the care nav label exactly. Nav is role-gated, so care volunteers without mailbox ownership never see the new 收件箱 — no muscle-memory collision. Do NOT rename to 智库 (that name is reserved for a possible future curated FAQ/knowledge base).

### 5.1 `/dashboard/inbox` — 3-pane per mockup tab ② (reuse dashboard shell)
- **Left rail**: group 「度化 · 全国」→ 🪷 智慧问答 row = deep link to existing care inbox page, badge = its existing pending count if cheaply available, else no badge. Group 「共修会事务信箱」→ my visible mailboxes (owner/centre_head: theirs; admin: all enabled, lock icon 🔒 on non-owned = break-glass). Badge = new_n (rose; gray when 0). Group 「其他」→ 🔁 内部往来 (threads kind='internal' involving my centres, both directions). Footer ghost button 「＋ 新增信箱（设置）」→ links to settings section.
- **Middle list**: header = mailbox name + filter chips 全部/未处理/处理中/已回复 (+归档 in overflow) + owners line 「负责人：…」. Rows per mockup: sender/from-centre bold when unhandled, time, subject, 1-line snippet, chips: status (sky 未处理 / jade 处理中·负责人 / gray 已回复), source (公开表单/内部往来), crisis rose chip 危机 when flagged, gold chip when linked_label present. Overdue rows (age>remind) get a subtle left border + 「x 天未处理」 small text.
- **Reading pane**: header (subject, meta line: sender · source · time · status chip). Bubbles: inbound plain, outbound jade `me`, note styled as 内部备注 (jade-soft with 「内部备注」 who-line, never counted as reply). Reply box: textarea + 模板 dropdown (message_templates active, inserts body) + buttons 发送回复 (primary) / 记内部备注 / 标记已回复 / 归档 / 转给其他信箱 ▾ (mailbox picker). Assign row: 指派负责人 select (owners of this mailbox only) + right-aligned 「🔒 每一步都记入审计日志」. If thread.contact_id null: jade suggestion chip 「💡 回复后可加入渡人名单（来源：表单）」+ button 加入渡人名单 → calls outreach endpoint, then chip becomes link 「查看渡人卡」. If linked_label: gold chip button 「打开{linked_label}」 deep-linking by linked_module/record (inventory request, finance receipt, event) — plain route mapping, no new integrations. Plumbing-A hint under reply box: 「回复保存在系统内；如需通知来信人，请按电话联系（E2b 才有邮件代发）。」
- **Escalation banner** (owner view, top of list): 「有 n 封超过 {remind_days} 天未处理」 when applicable.
- **Crisis strip** (admin + care≥edit, above rail content or page top): rose bar 「⚠ 危机来信 n — 即刻跟进」 → expands list linking threads (bypasses wall by design, §1.4).

### 5.2 HQ health view
For summary-level users, `/dashboard/inbox` renders ONLY the health board: card per enabled mailbox — centre name, 负责人 (or rose 未指派), big 未处理 n, 最旧 x 天, crisis n; plus surfaced list (>14d: subject + age only, no open link). Admin sees this board too (as overview) with 代管 buttons.

### 5.3 Settings (extend existing 设置 page with new sections)
- **收件箱配置**: table per mockup — 信箱 (centre), 负责人 multi-select from active volunteers (writes inbox_mailbox_owners, audits owner_added/owner_removed), 自动回复 toggle + text (shown on form success screen), 状态 启用/停用 toggle (is_enabled; disabled mailboxes drop off the public form picker; existing threads stay readable). Below: escalation days inputs (提醒共修会 x 天 / 上报总部 y 天 → org_settings inbox.escalation, audit settings_updated) and crisis keywords editor (tag list → inbox.crisis_keywords). Access: settings ≥ edit (admin, erp_admin).
- **共修会管理**: centres CRUD — list (code, name_cn, name_en, state, sort, is_active) + create/edit modal incl. aliases. New centre → mailbox auto-appears (DB trigger; surface a toast noting it). Deactivate = is_active false (keep data). Audit module='settings' centre_created/centre_updated. Access: settings ≥ edit.
- **通知与模板**: (a) 回复模板 CRUD on message_templates (title, body, is_active), audit template_*; (b) 通知名单 (opt-in): read-only list of contacts with notify_opt_in=true (name, phone, centre, opted at, note) + per-contact opt-in/out toggle & note (audits module='outreach' action='notify_opt_in_changed'). Line at top: 「只联系明确同意的人 — 不群发、不催促。」 Access: settings ≥ edit; opt-in toggle also allowed from 渡人卡 later (out of scope now).
- **义工与账号**: add 分会负责人 (centre_head) to the role dropdown; when selected force scope=own_center + require centre. Show hint 「分会负责人只看只管自己共修会（信箱、会员、活动、库存、渡人）」.

### 5.4 Public form — `src/app/m/page.tsx`
Same visual language as /f and /r pages. Fields: 共修会 select (enabled mailboxes, ordered by centres.sort, default 总会), 姓名*, 电话*, 邮箱 (optional), 主题*, 内容* (textarea), hidden honeypot `website`. Submit → success screen: 「已收到，感恩您的来信 🙏」 + mailbox auto_reply_text if enabled + the crisis-openness line (§1.4). Footer nav link on xlfm.my public site can come later — just make the route work.

### 5.5 主页 v2 — 今日待办驾驶舱 (Ken folded into E2, 2026-07-10; reference: mockup tab ①)
Upgrade the existing dashboard homepage into a role-aware cockpit. Iron rule: **the homepage only surfaces what the user could already open in the modules** — same wall logic, read-only counts + deep links, no new permissions. One server endpoint `GET /api/home/summary` assembles the role-shaped payload (no client-side fan-out).

Layout top→bottom:
1. Greeting + date — unchanged.
2. **今日概览 tiles** (up to 4, first ones the role qualifies for): care≥edit → 未读对话 (existing); inbox visible → 事务未处理 (sum over MY visible mailboxes, sub-line 最旧 x 天 · centre; summary roles get national totals); events≥edit → 待审报名; inventory≥edit → 低库存品项; fallback → 会员总数 (today's tile).
3. **Crisis strip** (admin OR care≥edit, hidden when 0): open crisis count (inbox crisis threads; include chat crisis count if cheap) → link.
4. Two columns: **收件箱 card** — admin/summary: mini health table (top 3 mailboxes by 未处理: 信箱/未处理/最旧/负责人) + >14d surfaced list (subject+age, the sanctioned exception) + 打开信箱; owner/centre_head: my mailbox's top 3 unhandled threads (sender, subject, age) deep-linking into the module; hidden at level none. **我的事项 card** (all roles) — cross-module assigned-to-me rows with module chips: inbox threads (assigned_to=me, status new/in_progress), care conversations I've taken over (existing logic), inventory requests awaiting my approval (only if an approver concept already exists — otherwise skip, don't invent one). Empty state 今日无待办 🙏.
5. Row of three: **渡人 · 本月** (outreach≥view; centre_head sees own-centre numbers): 新结缘 n + 开始念经 n this month + link. **最近会员动态** — unchanged. **系统动态** — make admin-only.
Keep it dependency-light: every number reuses queries that already exist for the modules; degrade gracefully (hide card) if a wing has no data.

## 6. Audit matrix (module='inbox' unless noted)
thread_created (form/internal) · replied · note_added · status_changed · assigned · transferred · break_glass_view · mailbox_updated · owner_added · owner_removed · template_created/updated/deleted · settings_updated · centre_created/centre_updated (module='settings') · added_to_outreach + notify_opt_in_changed (module='outreach'). Use the existing audit helper; before/after JSON where meaningful; never log message bodies for break_glass_view (mailbox-level only).

## 7. Explicit decisions (don't re-decide)
1. **029 note resolved**: inbox→渡人 contacts go channel='manual' + explicit first_contact milestone (matching E1b bridge), note text 「自动记录：初次接触（表单）」, source_type='form'. Never create form contacts with channel that fires the chat trigger.
2. **Unread = status 'new' count.** No per-user read tracking in E2 (conversation_reads stays chat-only).
3. Statuses fixed at 4 (新→处理中→已回复→归档); auto 'new'→'in_progress' on first outbound; manual overrides allowed.
4. No email anywhere (plumbing A). auto_reply_text renders on-screen only.
5. 智慧问答 panel untouched; rail entry is a link.
6. Co-organized events nuance from E1b unchanged; inbox has no event coupling beyond linked_* chips.
7. Escalation on read; no cron, no notifications in E2 (通知与模板 templates are for manual reuse).

## 8. Out of scope (E2b/E3 — do not build)
Gmail ingest/send · WhatsApp sending · 报表中心 pages · 权限矩阵 UI · 审计查看器 UI · per-centre 渡人 performance page · stage-vocab unification. (主页 v2 per §5.5 IS in scope — Ken's call 2026-07-10.)

## 9. Definition of done
Typecheck/build clean → push to main → Vercel deploy green. Reply here with: routes added, files touched, any contract deviations (and why), anything needing architect DB follow-up. Then Ken runs the browser test round below with Claude in Chrome; architect audits DB and cleans up test rows after (audit rows always stay).

---

# Browser test round (Claude in Chrome, Ken's session) — E2 + folded-in E1b bridge check

Preconditions (Ken in 设置 first): create test accounts if missing — `测试分会长` (role 分会负责人, centre 蒲种), keep an erp_admin account handy; in 收件箱配置 assign 测试分会长 as 蒲种 mailbox owner; leave 汶莱 mailbox 未指派/停用.

1. **Public form → HQ default**: open /m logged out, submit 测试来信一/0121110001, no centre → appears in 总会 HQ mailbox as 未处理, audit row thread_created.
2. **Public form → centre routing**: submit 测试来信二/0121110002 with 共修会=蒲种 → lands in 蒲种 only.
3. **Crisis escalate**: submit with body containing 「绝望」 → thread crisis_flag, appears in crisis strip for admin (and care volunteer account) immediately; NOT visible to 测试分会长 of another centre.
4. **Owner wall**: as 测试分会长 (蒲种): sees 蒲种 mailbox only; direct URL to an HQ thread id → 404; outreach queue also locked to 蒲种 (E1b wall regression).
5. **Summary wall**: as erp_admin: health board with counts/oldest-age only; no thread content anywhere; direct thread URL → 404.
6. **Break-glass**: as admin open 蒲种 mailbox → confirm dialog → content; architect later verifies audit_log break_glass_view row.
7. **Work the thread**: as 测试分会长 on 测试来信二 — insert 模板 reply, 发送回复 (status auto 处理中, first_response stamped), 记内部备注, 指派负责人 self, 标记已回复, then 归档 and un-archive via status filter. Each step audits.
8. **Transfer**: HQ owner transfers 测试来信一 → 蒲种; system note appears; thread now behind 蒲种 wall.
9. **加入渡人名单**: on 测试来信二 → creates contact 测试来信二 with centre 蒲种, first_contact milestone note 「…（表单）」, 渡人卡 opens; button idempotent on second click.
10. **内部往来**: as 测试分会长 compose internal to 总会 (subject 测试内部件, link label optional) → visible both sides; HQ replies; both see reply.
11. **E1b bridge mini-test (folded in)**: create event 测试E1B (any code except XLFM-2608) under 蒲种, publish; register 测试桥接二/0123334444 via /r; 带入渡人名单 on the registration → 渡人 queue shows 测试桥接二 with centre 蒲种.
12. **Settings CRUD**: toggle 蒲种 auto-reply on with text, resubmit form → text shows on success screen; edit escalation days to 1/2 and confirm banner/health surfacing changes (then set back 7/14); add+remove a crisis keyword; create/edit/deactivate a template; 共修会管理: create centre 测试共修会 → toast + mailbox row auto-appears in 收件箱配置 (leave 停用), then deactivate the centre.
13. **主页 v2 role check**: as admin — tiles incl. 事务未处理, inbox health mini-table, crisis strip when the step-3 crisis thread is open, 系统动态 visible; as 测试分会长 — only 蒲种 numbers, own threads in the 收件箱 card, NO 系统动态; as erp_admin — counts only, no thread subjects anywhere except the >14d surfaced list. Nav check: order 主页·收件箱·智慧问答·…, care volunteer without mailbox sees 智慧问答 but no 收件箱.
14. **主页 我的事项**: assign 测试来信二 to 测试分会长 → appears in their 我的事项 with 事务 chip; resolve → disappears.
15. Report everything; leave all test data for architect cleanup (audit rows stay).

---

# Appendix — migrations/030_inbox_foundation.sql (already applied to live DB; commit this file verbatim)

```sql
-- 030_inbox_foundation
-- E2 · 共修会事务信箱 (plumbing A: in-system inbox)
-- Tables + centre_head role, RLS walls per governance ruling, seeds. No existing data touched.

-- ============ 1. Tables ============

create table public.inbox_mailboxes (
  id uuid primary key default gen_random_uuid(),
  centre_id uuid not null unique references public.centres(id),
  is_enabled boolean not null default false,
  auto_reply_enabled boolean not null default false,
  auto_reply_text text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.inbox_mailbox_owners (
  mailbox_id uuid not null references public.inbox_mailboxes(id) on delete cascade,
  volunteer_id uuid not null references public.volunteers(id) on delete cascade,
  added_by uuid references public.volunteers(id),
  created_at timestamptz not null default now(),
  primary key (mailbox_id, volunteer_id)
);

create table public.inbox_threads (
  id uuid primary key default gen_random_uuid(),
  mailbox_id uuid not null references public.inbox_mailboxes(id),
  kind text not null default 'form' check (kind in ('form','internal')),
  from_centre_id uuid references public.centres(id),
  subject text not null,
  sender_name text,
  sender_phone text,
  sender_email text,
  status text not null default 'new' check (status in ('new','in_progress','replied','archived')),
  assigned_to uuid references public.volunteers(id),
  contact_id uuid references public.contacts(id),
  linked_module text,
  linked_record_id text,
  linked_label text,
  crisis_flag boolean not null default false,
  first_response_at timestamptz,
  last_message_at timestamptz not null default now(),
  created_by uuid references public.volunteers(id),
  created_at timestamptz not null default now(),
  constraint inbox_threads_internal_needs_from
    check (kind = 'form' or from_centre_id is not null)
);

create index inbox_threads_mailbox_idx on public.inbox_threads (mailbox_id, status, last_message_at desc);
create index inbox_threads_from_centre_idx on public.inbox_threads (from_centre_id) where from_centre_id is not null;
create index inbox_threads_contact_idx on public.inbox_threads (contact_id) where contact_id is not null;
create index inbox_threads_crisis_idx on public.inbox_threads (crisis_flag) where crisis_flag;

create table public.inbox_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.inbox_threads(id) on delete cascade,
  direction text not null check (direction in ('inbound','outbound','note')),
  body text not null,
  author_id uuid references public.volunteers(id),
  author_name text,
  created_at timestamptz not null default now()
);

create index inbox_messages_thread_idx on public.inbox_messages (thread_id, created_at);

create table public.message_templates (
  id uuid primary key default gen_random_uuid(),
  module text not null default 'inbox',
  title text not null,
  body text not null,
  is_active boolean not null default true,
  created_by uuid references public.volunteers(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.org_settings (
  key text primary key,
  value jsonb not null,
  updated_by uuid references public.volunteers(id),
  updated_at timestamptz not null default now()
);

-- Opt-in notify list (channel-agnostic; WhatsApp today). No cold blasting: opt-in only.
alter table public.contacts
  add column notify_opt_in boolean not null default false,
  add column notify_opt_in_at timestamptz,
  add column notify_opt_in_note text;

-- ============ 2. Auto-mailbox for new centres (一处维护，处处生效) ============

create or replace function public.auto_centre_mailbox()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  insert into public.inbox_mailboxes (centre_id)
  values (new.id)
  on conflict (centre_id) do nothing;
  return new;
end $$;

create trigger centres_auto_mailbox
after insert on public.centres
for each row execute function public.auto_centre_mailbox();

-- ============ 3. Access helper (governance wall, DB tier) ============

create or replace function public.can_read_inbox_thread(p_thread_id uuid)
returns boolean
language sql
stable security definer
set search_path to 'public', 'pg_temp'
as $$
  select exists (
    select 1
    from public.inbox_threads t
    join public.inbox_mailboxes m on m.id = t.mailbox_id
    where t.id = p_thread_id
      and (
        -- (a) mailbox owner
        exists (select 1 from public.inbox_mailbox_owners o
                where o.mailbox_id = m.id and o.volunteer_id = auth.uid())
        -- (b) inbox edit within centre scope (centre_head own centre; admin all)
        or (public.has_module_access('inbox','edit') and public.centre_scope_allows(m.centre_id))
        -- (c) internal threads: sender side too
        or (t.kind = 'internal' and t.from_centre_id is not null and (
              (public.has_module_access('inbox','edit') and public.centre_scope_allows(t.from_centre_id))
              or exists (select 1 from public.inbox_mailbox_owners o2
                         join public.inbox_mailboxes m2 on m2.id = o2.mailbox_id
                         where m2.centre_id = t.from_centre_id and o2.volunteer_id = auth.uid())
        ))
      )
  );
$$;

-- ============ 4. RLS ============

alter table public.inbox_mailboxes enable row level security;
alter table public.inbox_mailbox_owners enable row level security;
alter table public.inbox_threads enable row level security;
alter table public.inbox_messages enable row level security;
alter table public.message_templates enable row level security;
alter table public.org_settings enable row level security;

create policy "inbox module can read mailboxes" on public.inbox_mailboxes
  for select to authenticated
  using (
    public.has_module_access('inbox','summary')
    or exists (select 1 from public.inbox_mailbox_owners o
               where o.mailbox_id = id and o.volunteer_id = auth.uid())
  );

create policy "inbox owners readable" on public.inbox_mailbox_owners
  for select to authenticated
  using (
    volunteer_id = auth.uid()
    or public.has_module_access('inbox','summary')
  );

create policy "inbox thread content walled" on public.inbox_threads
  for select to authenticated
  using (public.can_read_inbox_thread(id));

create policy "inbox message content walled" on public.inbox_messages
  for select to authenticated
  using (public.can_read_inbox_thread(thread_id));

create policy "inbox module can read templates" on public.message_templates
  for select to authenticated
  using (public.has_module_access('inbox','summary'));

create policy "settings module can read org_settings" on public.org_settings
  for select to authenticated
  using (public.has_module_access('settings','view'));

-- ============ 5. Role: 分会负责人 (centre_head) + inbox module ============

-- extend allowed module list with 'inbox' (constraint predates this module)
alter table public.role_grants drop constraint role_grants_module_check;
alter table public.role_grants add constraint role_grants_module_check
  check (module = any (array['care'::text,'members'::text,'events'::text,'finance'::text,'duty'::text,'inventory'::text,'reports'::text,'settings'::text,'audit'::text,'outreach'::text,'inbox'::text]));

-- extend allowed volunteer roles with 'centre_head' (分会负责人)
alter table public.volunteers drop constraint volunteers_role_check;
alter table public.volunteers add constraint volunteers_role_check
  check (role = any (array['admin'::text,'volunteer'::text,'erp_admin'::text,'committee'::text,'finance_director'::text,'centre_finance'::text,'centre_head'::text]));

insert into public.role_grants (role, module, access) values
  ('admin','inbox','admin'),
  ('erp_admin','inbox','summary'),
  ('committee','inbox','summary'),
  ('centre_head','inbox','edit'),
  ('centre_head','members','edit'),
  ('centre_head','events','edit'),
  ('centre_head','inventory','edit'),
  ('centre_head','outreach','edit')
on conflict do nothing;

-- ============ 6. Seeds ============

-- one mailbox per centre; HQ enabled from day one
insert into public.inbox_mailboxes (centre_id, is_enabled)
select c.id, (c.code = 'HQ')
from public.centres c
on conflict (centre_id) do nothing;

insert into public.org_settings (key, value) values
  ('inbox.escalation', '{"remind_centre_days": 7, "surface_hq_days": 14}'::jsonb),
  ('inbox.crisis_keywords',
   '["自杀","自尽","轻生","想死","不想活","自残","自伤","绝望","了结","活不下去","bunuh diri","suicide","kill myself","end my life"]'::jsonb)
on conflict (key) do nothing;

insert into public.message_templates (module, title, body) values
  ('inbox','事务已收到','阿弥陀佛，感恩您的来信，我们已收到并会尽快处理。如需补充资料，义工会与您联系。感恩合十。'),
  ('inbox','收据补发说明','阿弥陀佛，您的收据补发申请已收到。请提供会员编号与所需月份，义工核实后会尽快为您安排。感恩合十。'),
  ('inbox','活动询问回复','阿弥陀佛，感恩您对活动的关心。活动详情与报名方式请留意本会通知；如需协助报名，请留下联系电话，义工会与您联系。感恩合十。');
```
