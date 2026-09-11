-- 047_rate_limits — durable request counters for the public chat endpoint (audit F03).
-- The previous limiter was an in-memory Map: it reset on every cold start and was
-- not shared across serverless instances, so it never actually bounded spend. One
-- caller hammering /api/chat drains the Anthropic balance — the same failure mode
-- as the five billing outages. Consumed by /api/chat before retrieval or any model call.
-- Applied 2026-09-11 via apply_migration; file docs/briefs/2026-09-11-batch-2.md §3.

create table if not exists public.rate_limits (
  key text not null,                       -- e.g. 'chat:browser:<id>' or 'chat:ip:<hash>'
  window_start timestamptz not null,       -- truncated to the window (10 min)
  count integer not null default 0 check (count >= 0),
  primary key (key, window_start)
);

-- Atomic increment-and-read, so two concurrent requests cannot both slip under the cap.
create or replace function public.rate_limit_hit(p_key text, p_window_start timestamptz)
returns integer
language sql
security definer
set search_path = public
as $$
  insert into public.rate_limits (key, window_start, count)
  values (p_key, p_window_start, 1)
  on conflict (key, window_start) do update set count = public.rate_limits.count + 1
  returning count;
$$;

-- Old windows are noise; the daily review cron can call this.
create or replace function public.rate_limits_prune(p_older_than interval default '1 day')
returns integer
language sql
security definer
set search_path = public
as $$
  with d as (delete from public.rate_limits where window_start < now() - p_older_than returning 1)
  select count(*)::integer from d;
$$;

alter table public.rate_limits enable row level security;
-- No policies: only the service role (which bypasses RLS) touches this table.

comment on table public.rate_limits is
  'Per-key request counters for the public chat endpoint, 10-minute windows. Increment via rate_limit_hit(); prune via rate_limits_prune(). See docs/briefs/2026-09-11-batch-2.md §3.';
