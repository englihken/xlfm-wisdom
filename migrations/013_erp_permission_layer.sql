-- 013_erp_permission_layer.sql
-- =====================================================================================
-- PURPOSE (ERP task A2 — module-permission layer, "one platform, two wings").
--   Introduces a DB-driven (role × module → access-level) grant matrix so that a
--   single Supabase project can host both the care wing (contacts/conversations/
--   messages) and the coming ERP wing (members/events/finance/duty) WITHOUT any
--   authenticated account being able to read across wings.
--
--   Today the care tables carry `USING (true)` SELECT policies, so ANY authenticated
--   user (including a future erp_admin/committee login) can read all care data via
--   PostgREST. This migration closes that door: the care SELECT policies now require
--   public.has_module_access('care','view'), which is true only for roles that hold a
--   care grant in public.role_grants (admin, volunteer). App routes gate on the same
--   matrix via requireModuleAccess() in src/lib/supabase-server.ts.
--
--   No ERP tables are created here (that is A3). No app writes are opened up — writes
--   stay service-role-only (no INSERT/UPDATE/DELETE policies). This is purely the
--   permission substrate + the care-read tightening.
--
-- APPLY MANUALLY: paste into the Supabase SQL Editor (this repo applies migrations by
--   hand — there is no CLI runner). Run docs/erp/01-a2-verification.md PREFLIGHT first;
--   if it does not match the stated expectation, STOP and reconcile before applying.
--
-- ROLLBACK (manual — restores the pre-013 state):
--   -- restore the old care SELECT policies:
--   drop policy if exists "care module can read contacts"      on public.contacts;
--   drop policy if exists "care module can read conversations" on public.conversations;
--   drop policy if exists "care module can read messages"      on public.messages;
--   create policy "volunteers can read contacts"      on public.contacts      for select to authenticated using (true);
--   create policy "volunteers can read conversations" on public.conversations for select to authenticated using (true);
--   create policy "volunteers can read messages"      on public.messages      for select to authenticated using (true);
--   -- restore the old 2-value role CHECK (the original constraint was auto-named; this
--   -- restores the RULE — the name will differ, which is harmless):
--   alter table public.volunteers drop constraint if exists volunteers_role_check;
--   alter table public.volunteers add  constraint volunteers_role_check check (role in ('admin','volunteer'));
--   -- drop the permission layer:
--   drop function if exists public.has_module_access(text, text);
--   drop function if exists public.access_rank(text);
--   drop table    if exists public.role_grants;
-- =====================================================================================

-- ── (a) role_grants: the (role × module → access) matrix ──────────────────────────────
create table public.role_grants (
  role text not null,
  module text not null check (module in ('care','members','events','finance','duty','settings','audit')),
  access text not null check (access in ('summary','view','edit','admin')),
  primary key (role, module)
);
alter table public.role_grants enable row level security;  -- NO policies: service-role + definer fn only


-- ── (b) widen volunteers.role to the 4 platform roles ────────────────────────────────
-- The existing role CHECK from migrations/006 is auto-named; find it dynamically and
-- drop it, then add a named replacement.
do $$
declare
  c_name text;
begin
  select conname
    into c_name
    from pg_constraint
   where conrelid = 'public.volunteers'::regclass
     and contype  = 'c'
     and pg_get_constraintdef(oid) ilike '%role%'
   limit 1;

  if c_name is not null then
    execute format('alter table public.volunteers drop constraint %I', c_name);
  end if;
end $$;

alter table public.volunteers
  add constraint volunteers_role_check
  check (role in ('admin','volunteer','erp_admin','committee'));


-- ── (c) access_rank(): order the access levels (mirrors ACCESS_RANK in TS) ────────────
create or replace function public.access_rank(p_access text)
returns int
language sql
immutable
as $$
  select case p_access
    when 'none'    then 0
    when 'summary' then 1
    when 'view'    then 2
    when 'edit'    then 3
    when 'admin'   then 4
    else -1
  end;
$$;


-- ── (d) has_module_access(): does the CURRENT user hold >= p_min access to p_module? ──
-- SECURITY DEFINER so it can read volunteers + role_grants (both RLS-locked) on behalf
-- of the calling authenticated user. Returns false for no session / inactive / no grant.
create or replace function public.has_module_access(p_module text, p_min text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    (
      select public.access_rank(rg.access) >= public.access_rank(p_min)
        from public.volunteers v
        join public.role_grants rg
          on rg.role = v.role
         and rg.module = p_module
       where v.id = auth.uid()
         and v.active = true
    ),
    false
  );
$$;

revoke all on function public.access_rank(text)              from public;
revoke all on function public.has_module_access(text, text)  from public;
grant execute on function public.access_rank(text)             to authenticated;
grant execute on function public.has_module_access(text, text) to authenticated;


-- ── (e) seed the grant matrix (only non-none rows; an absent row means 'none') ───────
-- 16 rows. (An account's access to a module is 'none' unless a row grants otherwise.)
insert into public.role_grants (role, module, access) values
  -- admin — full platform, incl. read access to the audit trail
  ('admin',     'care',     'admin'),
  ('admin',     'members',  'admin'),
  ('admin',     'events',   'admin'),
  ('admin',     'finance',  'admin'),
  ('admin',     'duty',     'admin'),
  ('admin',     'settings', 'admin'),
  ('admin',     'audit',    'view'),
  -- erp_admin — ERP wing only; NO care access, NO audit access
  ('erp_admin', 'members',  'admin'),
  ('erp_admin', 'events',   'admin'),
  ('erp_admin', 'finance',  'admin'),
  ('erp_admin', 'duty',     'admin'),
  ('erp_admin', 'settings', 'edit'),
  -- volunteer — care wing only
  ('volunteer', 'care',     'edit'),
  -- committee — read-oriented ERP visibility
  ('committee', 'members',  'summary'),
  ('committee', 'events',   'view'),
  ('committee', 'finance',  'view');


-- ── (f) replace the three care SELECT policies (was USING(true)) ─────────────────────
-- Writes stay service-role-only: no INSERT/UPDATE/DELETE policies are added.
drop policy if exists "volunteers can read contacts" on public.contacts;
create policy "care module can read contacts" on public.contacts
  for select to authenticated using (public.has_module_access('care','view'));

drop policy if exists "volunteers can read conversations" on public.conversations;
create policy "care module can read conversations" on public.conversations
  for select to authenticated using (public.has_module_access('care','view'));

drop policy if exists "volunteers can read messages" on public.messages;
create policy "care module can read messages" on public.messages
  for select to authenticated using (public.has_module_access('care','view'));
