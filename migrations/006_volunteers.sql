-- Phase 3 (user management): the `volunteers` table.
--
-- One row per dashboard user, keyed to their Supabase Auth account. `role` gates
-- admin-only features (Step 2), `active` gates dashboard access entirely: the
-- server-side getActiveVolunteer() helper only grants access when a matching row
-- exists AND active = true.
--
-- RLS is enabled with NO policies, exactly like the other care tables — every
-- read/write goes through the service-role key (supabaseAdmin) from auth-gated
-- server routes; the anon/authenticated roles get no direct access.

create table volunteers (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  display_name text,
  role text not null default 'volunteer' check (role in ('admin', 'volunteer')),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- Locked to the service_role key only (no policies granted); see 003/004 for the
-- same convention on the care tables.
alter table volunteers enable row level security;

-- NOTE: existing users were bootstrapped manually (inserts run directly in the
-- Supabase SQL Editor), including the first admin account. There is no seed data
-- here on purpose — the rows reference real auth.users ids created at signup.
