-- 049: pinned 智库 entries — approved entries with pinned=true are appended to the
-- sources of EVERY reply turn (canonical tier), independent of retrieval similarity.
-- Purpose: ground the movement's standard per-sutra counts (《入门手册》pp.17–21) in
-- every 功课 round so the verbatim guard stops stripping standard numbers
-- (2026-09-12 Sonnet watch: 7/33 turns got the blanket tail for exactly this).
-- Applied by the architect via apply_migration on 2026-09-12 (project adxetazkbdoahfphnini).
alter table public.wisdom_entries
  add column if not exists pinned boolean not null default false;

comment on column public.wisdom_entries.pinned is
  'approved + pinned entries are included in every reply turn as canonical sources (not similarity-gated)';

create index if not exists wisdom_entries_pinned_approved_idx
  on public.wisdom_entries (language)
  where pinned and status = 'approved';
