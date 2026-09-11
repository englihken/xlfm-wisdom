-- 048_message_flags — pipeline soft-check flags on assistant messages
-- (model switch 2026-09-11 §3). First flag: 'citation_no_date' — the reply cites
-- a website-QA source (解答来信疑惑 / 玄艺问答 / 玄艺综述 / 玄学问答 / 精彩节目摘录)
-- without its 开示/节目 date even after one format-reminder regeneration. The
-- reply ships unchanged (no strip, no tail); the flag lets the review queue and
-- the Sonnet watch count it. Applied 2026-09-11 via apply_migration.

alter table public.messages add column if not exists flags text[];
create index if not exists messages_flags_idx on public.messages using gin (flags) where flags is not null;
