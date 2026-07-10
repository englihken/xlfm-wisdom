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
