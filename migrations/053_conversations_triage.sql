-- 053: 功课分诊（2026-09-24 homework-intake-flow brief）— applied to production 2026-09-24 by the architect.
-- triage_asked_at: the pipeline asked 「你是刚接触，还是已经在念经做功课了？」 in this conversation (asked at most once).
-- triage_answer: what the visitor tapped/said — 'beginner' | 'practising'; null = not answered (yet).
alter table conversations
  add column if not exists triage_asked_at timestamptz,
  add column if not exists triage_answer text;
alter table conversations
  drop constraint if exists conversations_triage_answer_check;
alter table conversations
  add constraint conversations_triage_answer_check check (triage_answer is null or triage_answer in ('beginner','practising'));
comment on column conversations.triage_asked_at is '功课分诊问句已问（每通最多一次）— brief 2026-09-24-homework-intake-flow';
comment on column conversations.triage_answer is '分诊答案 beginner|practising；null=未答';
