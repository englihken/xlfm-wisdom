# 渡人 outreach workbench (Phase E1)

Built on `migrations/027_outreach.sql` + `migrations/028_contacts_phone.sql` (**both applied to prod
2026-07-10** via the connector — never run locally). The 渡人 door is a **workbench, not a dashboard**:
recording milestones on real people IS the work. All charts / monthly reports / CSV / print are
**deliberately excluded** and parked for the future 报表中心 (E3) — including the 90-day "event-effect"
window idea (did attendance at event X lift chanting within 90 days).

## Schema meaning

- **`contact_milestones`** is the journey LEDGER: `first_contact → attended → started_chanting →
  steady_practice → volunteer`, one row max per `(contact, milestone)`. A person counts once per rung.
  Rows are kindness records — `happened_on` is editable and a mis-tap is deletable (both audited).
- **`contacts`** gained source attribution (`source_type` chat/event/referral/walkin + `source_event_id`
  + `source_note`), a nurturing `centre_id`, an optional `member_id` link, and (028) a plain `phone`.
- **`contacts.stage` is NEVER written here** — it stays the care module's legacy field. 渡人 shows it only
  as a gray `旧记录` chip when it's a legacy value (学习中/共修者/义工). Vocabularies unify in E3.

## Rung derivation (never stored)

A person's current rung = the **highest milestone present** in their ledger (`deriveRung` in
`src/lib/outreach.ts`). Empty → `first_contact` (the 027 backfill gave every existing contact one). The
queue's "最后动静" = `max(latest milestone happened_on, contacts.last_seen)`.

## The workbench (`/dashboard/outreach`)

- Header = four PLAIN numbers (no charts): 本月新结缘 · 本月开始念经 · 名单总数 · **超过30天没动静** (the
  queue's conscience). `GET /api/dashboard/outreach/summary`.
- 善缘名单 queue: name / phone / source / rung / centre / 最后动静, sortable **最久未跟进 (default)** or
  最近动静, filterable by source / rung / centre + name-or-phone search, paginated.
- 渡人卡 drawer: milestone timeline (dates editable; deletable except `first_contact`), big next-rung
  buttons (`attended` gets an optional event picker), editable phone/source/centre, a member-link picker,
  a 查看对话 link when a conversation exists, and the legacy-stage chip.
- ＋新增善缘 adds a manual 善缘 (contacts row `channel='manual'`, `stage='初次接触'` + a `first_contact`
  milestone).

## Ethics (enforced by tone, not just code)

只记录善缘的成长 — no rankings, no per-volunteer stats, no chasing language, no "overdue". 超过30天没动静 is
framed as a gentle prompt, not a scoreboard.

## APIs

All `supabaseAdmin`, gated `requireModuleAccess('outreach', 'view'|'edit')`, `writeAudit` on every
mutation with precise actions (`outreach.person_create` / `.person_update` / `.milestone_record` /
`.milestone_update` / `.milestone_delete`): `summary`, `persons` (GET queue / POST create — 409
`已在名单中` on same-name+same-event), `persons/[id]` (GET card / PATCH — never stage), `milestones`
(POST — 409 `已记录过`), `milestones/[id]` (PATCH / DELETE — rejects `first_contact`), `member-search`,
and `meta` (centres + events, served under the outreach grant so 关怀义工 don't need members/events:view).

## Two embedded entry points

- **Care inbox** contact panel: a compact 渡人 section (rung chip + next-step buttons + 打开渡人卡 link),
  rendered only for outreach:edit. The link opens `/dashboard/outreach?contact=<id>` (the page opens that
  drawer on load). No other inbox changes.
- **Events queue**: a `带入渡人名单` button per registration → bridges `applicant_name` + `applicant_phone`
  (source_type='event', source_event_id) into the list; 409 → 已在名单中 with a link.

## Decisions taken (not spelled out in the brief)

1. Migration records saved under `migrations/` (the repo's established location for all 001–028 records),
   not `supabase/migrations/`; content is byte-identical to the brief.
2. Added `/api/dashboard/outreach/meta` (centres + events under the outreach grant) — the brief said
   "reuse the events list API", but 关怀义工 lack events:view/members:view, so reusing `/api/dashboard/events`
   would 403 for the primary user. Same pattern the inventory module already uses.
3. Manual-add dedupe applies only when `source_event_id` is present (the bridge case). Pure manual adds
   allow namesakes (a walk-in shouldn't be blocked by an unrelated same-name contact).
4. Added one additive field (`phone: applicant_phone`) to the registrations-list response so the bridge
   can carry the phone as the brief requires; no behavioral change to events.
5. 查看对话 links to the inbox root (`/dashboard`) — there is no per-contact inbox deep link yet.
