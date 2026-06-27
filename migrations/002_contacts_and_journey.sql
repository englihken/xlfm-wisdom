-- Phase 2 Step 2: contacts layer + journey + future-proof fields
create table contacts (
  id uuid primary key default gen_random_uuid(),
  channel text not null default 'web',
  wa_id text,
  browser_id text,
  display_name text,
  stage text default '初次接触',
  summary text,
  notes text,
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now()
);
create unique index idx_contacts_wa on contacts(wa_id) where wa_id is not null;
create unique index idx_contacts_browser on contacts(browser_id) where browser_id is not null;
alter table conversations
  add column contact_id uuid references contacts(id) on delete cascade,
  add column summary text,
  add column assigned_volunteer uuid,
  add column retain boolean not null default false;
create index idx_conversations_contact on conversations(contact_id);
