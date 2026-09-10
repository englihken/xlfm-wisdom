-- 045_failed_replies — dead-letter queue for AI replies that failed to generate.
-- Brief: claude/reliability-brief.md ("别再把访客弄丢", 2026-08-30).
-- Over 30 days 508 of 1,128 conversations (45%) received no reply at all;
-- 08-26..28 went dark for three days (116 visitors) because the Anthropic
-- balance ran out and the failed turns were simply lost. This table keeps them.
-- Consumed by src/lib/reply-recovery.ts and src/lib/ops-alerts.ts.
-- Applied 2026-08-30 via apply_migration; file written back 2026-09-10 (audit F10).

create table if not exists public.failed_replies (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  error_kind text not null default 'other'
    check (error_kind in ('quota','rate_limit','timeout','other')),
  error_detail text,
  attempts integer not null default 0 check (attempts >= 0),
  status text not null default 'queued'
    check (status in ('queued','retrying','recovered','handed_off')),
  created_at timestamptz not null default now(),
  last_attempt_at timestamptz
);

create index if not exists failed_replies_open_idx
  on public.failed_replies (created_at)
  where status in ('queued','retrying');

create index if not exists failed_replies_conversation_idx
  on public.failed_replies (conversation_id);

-- At most ONE open row per conversation: makes enqueueFailedReply's
-- select-then-insert race-safe (.maybeSingle() would throw on two).
create unique index if not exists failed_replies_one_open_per_conversation
  on public.failed_replies (conversation_id)
  where status in ('queued','retrying');

alter table public.failed_replies enable row level security;

create policy "care module can read failed replies"
  on public.failed_replies for select
  using (has_module_access('care','view'));

create policy "care editors can update failed replies"
  on public.failed_replies for update
  using (has_module_access('care','edit'))
  with check (has_module_access('care','edit'));

comment on table public.failed_replies is
  'Dead-letter queue for AI replies that failed to generate. Backoff 1m/5m/30m/2h then handed_off (conversation → needs_human). Quota failures do not burn attempts. See claude/reliability-brief.md.';
