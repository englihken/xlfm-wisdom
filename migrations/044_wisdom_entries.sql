-- 044_wisdom_entries — P2 智库 curated answers (claude/p2-brief.md).
-- Applied to production via Supabase apply_migration by the architect; this file is
-- the exact live DDL, written back on 2026-09-10 (audit F10).
-- Approved entries are synced to Pinecone as canonical_ruling docs (wisdom_{id}).

create table if not exists public.wisdom_entries (
  id uuid primary key default gen_random_uuid(),
  canonical_question text not null,
  variants text,
  keywords text,
  answer_guidance text not null,
  language text not null default 'zh' check (language in ('zh','en','id')),
  status text not null default 'draft' check (status in ('draft','approved','retired')),
  source_conversation_id uuid references public.conversations(id),
  source_review_id uuid references public.conversation_reviews(id),
  created_by uuid references public.volunteers(id),
  approved_by uuid references public.volunteers(id),
  approved_at timestamptz,
  use_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists wisdom_entries_status_idx on public.wisdom_entries (status);
create index if not exists wisdom_entries_language_idx on public.wisdom_entries (language);

alter table public.wisdom_entries enable row level security;

create policy "care module can read wisdom entries"
  on public.wisdom_entries for select
  using (has_module_access('care','view'));

create policy "care editors can draft wisdom entries"
  on public.wisdom_entries for insert
  with check (has_module_access('care','edit'));

create policy "care editors can update wisdom entries"
  on public.wisdom_entries for update
  using (has_module_access('care','edit'))
  with check (has_module_access('care','edit'));
