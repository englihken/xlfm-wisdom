-- Inbox usability: per-volunteer read tracking for unread indicators.
-- One row per (volunteer, conversation) recording when that volunteer last opened
-- it. The list API compares last_read_at against the conversation's
-- last_message_at to decide `unread` (no row = never opened = unread).
create table conversation_reads (
  volunteer_id uuid not null references volunteers(id) on delete cascade,
  conversation_id uuid not null references conversations(id) on delete cascade,
  last_read_at timestamptz not null default now(),
  primary key (volunteer_id, conversation_id)
);

-- RLS on, no policies: service-role (backend) access only, same convention as the
-- other dashboard tables. All reads/writes go through the auth-gated API routes.
alter table conversation_reads enable row level security;
