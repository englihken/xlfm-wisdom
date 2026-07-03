-- Phase 3 (auto-summary cron): mark when a conversation has been folded into its
-- contact's evolving care summary.
--
-- NULL  = not yet processed (the daily /api/cron/summarize job will pick it up
--         once the conversation has been idle 2+ hours).
-- set   = timestamp of the run that summarised it; the job skips it thereafter.
-- This is what makes the cron idempotent and cheap — each conversation is
-- summarised at most once.
alter table conversations add column summarized_at timestamptz;
