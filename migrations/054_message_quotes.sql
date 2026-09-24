-- 054: 已核实引文的跨轮记忆（2026-09-24 quote-memory-and-prayer-fidelity brief）— applied to production 2026-09-24 by the architect.
-- One row per verified quote block (or verified prayer line) in an assistant reply:
-- which retrieved chunk grounded it, so later turns can (a) re-verify a re-quoted line
-- against the same chunk and (b) answer 「列出出处」 without re-retrieving.
create table if not exists message_quotes (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations(id) on delete cascade,
  message_id uuid not null references messages(id) on delete cascade,
  quote_text text not null,
  chunk_id text not null,
  chunk_text text not null,
  book text,
  chunk_type text,
  page_start int,
  page_end int,
  post_title text,
  url text,
  original_date text,
  created_at timestamptz not null default now()
);
create index if not exists message_quotes_conversation_idx on message_quotes(conversation_id, created_at desc);
comment on table message_quotes is '每条已通过逐字核对的引文及其所依据的检索段落（brief 2026-09-24-quote-memory-and-prayer-fidelity）';
