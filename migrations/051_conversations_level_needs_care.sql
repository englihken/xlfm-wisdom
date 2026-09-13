-- 051: visitor level + care follow-up flag (brief 2026-09-13-fellow-practitioner-mode)
-- level: decided pre-reply from keyword cues (level-cues.ts) and the post-reply Haiku
-- classifier; persisted per conversation and only ever upgraded. contacts.stage set by a
-- volunteer (同修 = experienced) takes precedence at read time.
-- Applied by the architect via apply_migration on 2026-09-13 (project adxetazkbdoahfphnini).
alter table public.conversations
  add column if not exists level text
    check (level in ('new','beginner','practising','experienced')),
  add column if not exists needs_care boolean not null default false;

comment on column public.conversations.level is
  'visitor practice level (new|beginner|practising|experienced); upgrade-only; volunteer-set contacts.stage overrides';
comment on column public.conversations.needs_care is
  'elderly / vulnerable signals detected — surface in the care inbox 关怀跟进 filter for a volunteer to follow up';

create index if not exists conversations_needs_care_idx on public.conversations (needs_care) where needs_care;
