-- =====================================================================================
-- 027_outreach.sql — 渡人 conversion funnel (Phase E1)      [APPLIED VIA CONNECTOR]
-- =====================================================================================
-- Design: claude project claude/phase-e-design-mockup.html (tab ③ 渡人).
--   • contact_milestones = the journey LEDGER (funnel counts derive from it):
--     first_contact → attended → started_chanting → steady_practice → volunteer.
--     ONE row max per (contact, milestone) — a person counts once per rung.
--     Volunteer-friendly: happened_on editable, a wrong tap is deletable (audit_log
--     records both) — these are kindness records, not money.
--   • contacts gains source attribution (chat/event/referral/walkin + which event),
--     nurturing centre, and an optional link to the member record once they join.
--   • contacts.stage is NOT touched — it stays the care module's legacy field.
--     渡人 derives a person's rung from milestones only. Vocabularies unify in E3.
--   • New module key 'outreach' (UI: 渡人): admin=admin, volunteer(关怀义工)=edit,
--     erp_admin=view, committee=view.
-- =====================================================================================

-- ---------- 1. module key + grants ----------

alter table public.role_grants drop constraint if exists role_grants_module_check;
alter table public.role_grants add constraint role_grants_module_check
  check (module in ('care','members','events','finance','duty','inventory',
                    'reports','settings','audit','outreach'));

insert into public.role_grants (role, module, access) values
  ('admin',     'outreach', 'admin'),
  ('volunteer', 'outreach', 'edit'),
  ('erp_admin', 'outreach', 'view'),
  ('committee', 'outreach', 'view')
on conflict (role, module) do nothing;

-- ---------- 2. contacts: source attribution + journey links ----------

alter table public.contacts add column if not exists source_type text
  check (source_type in ('chat','event','referral','walkin'));
alter table public.contacts add column if not exists source_event_id uuid
  references public.events(id);
alter table public.contacts add column if not exists source_note text;
alter table public.contacts add column if not exists centre_id uuid
  references public.centres(id);
alter table public.contacts add column if not exists member_id uuid
  references public.members(id);

create index if not exists contacts_source_event_idx
  on public.contacts(source_event_id) where source_event_id is not null;
create index if not exists contacts_centre_idx
  on public.contacts(centre_id) where centre_id is not null;

-- All existing contacts arrived via the chat (web/whatsapp) — factual backfill.
update public.contacts set source_type = 'chat' where source_type is null;

-- ---------- 3. contact_milestones: the journey ledger ----------

create table if not exists public.contact_milestones (
  id          uuid primary key default gen_random_uuid(),
  contact_id  uuid not null references public.contacts(id) on delete cascade,
  milestone   text not null check (milestone in
                ('first_contact','attended','started_chanting','steady_practice','volunteer')),
  happened_on date not null default current_date,
  event_id    uuid references public.events(id),   -- which activity (esp. 'attended')
  noted_by    uuid references public.volunteers(id),
  note        text,
  created_at  timestamptz not null default now(),
  unique (contact_id, milestone)
);

create index if not exists contact_milestones_contact_idx
  on public.contact_milestones(contact_id);
create index if not exists contact_milestones_kind_date_idx
  on public.contact_milestones(milestone, happened_on);

-- ---------- 4. Backfill: every existing contact factually made first contact ----------

insert into public.contact_milestones (contact_id, milestone, happened_on, note)
select id, 'first_contact', first_seen::date, '迁移：由结缘人档案带入'
from public.contacts
on conflict (contact_id, milestone) do nothing;

-- ---------- 5. RLS (service-role routes are the real path; SELECT-only guard) ----------

alter table public.contact_milestones enable row level security;
create policy contact_milestones_select on public.contact_milestones
  for select using (public.has_module_access('outreach','view'));

-- ---------- VERIFY (read-only; run after apply) ----------
-- select count(*) from contact_milestones where milestone='first_contact'; -- = contacts count (168)
-- select role, access from role_grants where module='outreach';            -- 4 rows
-- select source_type, count(*) from contacts group by 1;                   -- chat = all
