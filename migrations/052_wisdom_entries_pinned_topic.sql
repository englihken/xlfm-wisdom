-- 052: topic-pinned 智库 entries. pinned=true attaches to EVERY turn; pinned_topic attaches
-- only to turns whose RetrievalContext.topic matches (e.g. 'xiaofangzi'), so long procedural
-- cards (the 东方台秘书处 小房子 SOP, 2017.12) ride along with the topic without costing
-- tokens on unrelated questions.
-- Applied by the architect via apply_migration on 2026-09-16 (project adxetazkbdoahfphnini).
alter table public.wisdom_entries
  add column if not exists pinned_topic text
    check (pinned_topic is null or pinned_topic in ('xiaofangzi','altar','fangsheng','dreams','crisis'));

comment on column public.wisdom_entries.pinned_topic is
  'approved entries with this topic are attached to every turn whose retrieval topic matches (canonical tier); null = similarity-retrieved only';

create index if not exists wisdom_entries_pinned_topic_idx
  on public.wisdom_entries (pinned_topic) where pinned_topic is not null and status = 'approved';
