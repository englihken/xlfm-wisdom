-- 046_chip_answers — cached replies for the six fixed homepage chip questions.
-- Finding: claude/latency-finding-2026-09-10.md. 20.4% of conversations start
-- with a chip; each one paid 30–60 s of Opus thinking for a fixed answer.
-- Consumed by /api/chat (cache lookup → SSE) and the nightly refresh cron.
-- Applied 2026-09-10 via apply_migration; file written back the same day.

create table if not exists public.chip_answers (
  id uuid primary key default gen_random_uuid(),
  chip_key text not null,
  language text not null check (language in ('zh','en','id')),
  question text not null,
  answer_text text not null,
  sources jsonb not null default '[]'::jsonb,
  model text not null,
  guard_outcome text not null check (guard_outcome in ('clean','passed_after_retry')),
  generated_at timestamptz not null default now(),
  invalidated_at timestamptz,
  unique (chip_key, language)
);

create index if not exists chip_answers_lookup_idx
  on public.chip_answers (question, language)
  where invalidated_at is null;

alter table public.chip_answers enable row level security;

create policy "care module can read chip answers"
  on public.chip_answers for select
  using (has_module_access('care','view'));

create policy "care editors can invalidate chip answers"
  on public.chip_answers for update
  using (has_module_access('care','edit'))
  with check (has_module_access('care','edit'));

comment on table public.chip_answers is
  'Cached, guard-verified replies for the six homepage chip questions (×3 languages). Served in <1s; refreshed nightly; invalidated when a 智库 entry is approved. See claude/latency-finding-2026-09-10.md.';
