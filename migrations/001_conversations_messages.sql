-- Phase 2 Step 1: conversations + messages tables
create table conversations (
  id uuid primary key default gen_random_uuid(),
  channel text not null default 'web',
  status text not null default 'ai_handling',
  language text default 'zh',
  created_at timestamptz not null default now(),
  last_message_at timestamptz not null default now()
);
create table messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations(id) on delete cascade,
  role text not null,
  content text not null,
  sources jsonb,
  created_at timestamptz not null default now()
);
create index idx_messages_conversation on messages(conversation_id, created_at);
create index idx_conversations_recent on conversations(last_message_at desc);
