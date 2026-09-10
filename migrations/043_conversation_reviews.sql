-- 043_conversation_reviews — P1 self-review loop (claude/care-review-loop-design.md).
-- Applied to production via Supabase apply_migration on 2026-08-xx by the architect;
-- this file is the exact live DDL, written back on 2026-09-10 (audit F10).
-- One row per reviewed conversation, written by the nightly review cron.

create table if not exists public.conversation_reviews (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null unique references public.conversations(id) on delete cascade,
  verdict text not null check (verdict in ('good','ok','needs_improvement')),
  reason text,
  improvement_hint text,
  question_key text,
  emotional_weight text not null default 'none' check (emotional_weight in ('none','light','heavy')),
  model text,
  reviewed_at timestamptz not null default now(),
  status text not null default 'open' check (status in ('open','dismissed','handled','drafted')),
  dismissed_reason text,
  handled_by uuid references public.volunteers(id),
  handled_at timestamptz
);

create index if not exists conversation_reviews_question_key_idx on public.conversation_reviews (question_key);
create index if not exists conversation_reviews_verdict_status_idx on public.conversation_reviews (verdict, status);
create index if not exists conversation_reviews_reviewed_at_idx on public.conversation_reviews (reviewed_at);

alter table public.conversation_reviews enable row level security;

create policy "care module can read conversation reviews"
  on public.conversation_reviews for select
  using (has_module_access('care','view'));

create policy "care editors can disposition conversation reviews"
  on public.conversation_reviews for update
  using (has_module_access('care','edit'))
  with check (has_module_access('care','edit'));
