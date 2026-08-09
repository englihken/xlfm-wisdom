-- Batch-API bookkeeping for the nightly care-summary cron (cost: Message
-- Batches run at 50% of standard token prices).
--
-- The cron no longer calls Claude synchronously per contact. Instead it submits
-- ONE message batch (one request per contact) and records it here, together
-- with the exact contact → conversation-id mapping the prompts were built from.
-- Results are applied either later in the same run (small batches usually
-- finish within minutes) or on the next nightly run. Conversations stay
-- unsummarized (summarized_at NULL) until results are applied, so a lost or
-- expired batch simply gets re-folded next run — nothing is ever dropped.
--
-- payload shape: [{ "contact_id": "...", "conversation_ids": ["...", ...] }]
-- (conversation_ids in prompt order — gist N in the model output maps to
-- conversation_ids[N]).
create table summary_batches (
  id uuid primary key default gen_random_uuid(),
  batch_id text not null unique,          -- Anthropic msgbatch_... id
  payload jsonb not null,
  status text not null default 'submitted'
    check (status in ('submitted', 'done', 'expired', 'failed')),
  created_at timestamptz not null default now(),
  processed_at timestamptz
);

-- Service-role only (the cron). RLS on with no policies = invisible to anon
-- and authenticated clients.
alter table summary_batches enable row level security;
