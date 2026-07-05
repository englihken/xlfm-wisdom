-- 016_events_schema.sql
-- =====================================================================================
-- PURPOSE (ERP task B1 — Phase B events schema).
--   The events wing: events + their per-event fee items (event_fees) + volunteer-team
--   needs (event_team_needs) + registrations. All centre-owned via each event's
--   organizing_centre_id, composing the same two-dimension gate as the members wing
--   (015): has_module_access('events','view') AND centre_scope_allows(centre_id).
--
--   Writes stay service-role-only (NO write policies); audit is app-level via
--   writeAudit (not triggers), same as the rest of the platform. No app code here.
--
--   SCOPE NOTE: for today's roles this scope composition changes NOTHING — admin and
--   erp_admin (who hold events:admin from the 013 seed) are both all_centers, so
--   centre_scope_allows is always true for them. The composition exists so Phase D
--   centre-scoped roles inherit the proven pattern rather than a retrofit.
--
--   DESIGN NOTES:
--     • event_fees: one row per ENABLED fee item; the SIX-item vocabulary is fixed by
--       CHECK, amounts are per-event. A disabled item simply has no row.
--     • registrations.member_id is nullable BY DESIGN — Phase C public newcomers submit
--       applicant_name/phone before a member exists; the B admin flow sets member_id.
--       reg_identity CHECK guarantees at least one identity is present.
--     • fee_breakdown is a SNAPSHOT locked at submission (prices can change later).
--     • NO delete anywhere — 'cancelled' is a registration status.
--
-- APPLY MANUALLY (Supabase SQL Editor). Run docs/erp/07-b1-verification.md PREFLIGHT
--   first; STOP on any deviation.
--
-- ROLLBACK (manual — reverse dependency order; dropping a table drops its RLS policies):
--   drop table if exists public.registrations;
--   drop table if exists public.event_team_needs;
--   drop table if exists public.event_fees;
--   drop table if exists public.events;
-- =====================================================================================


-- ── (a) events ───────────────────────────────────────────────────────────────────────
create table public.events (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,                       -- 'XLFM-2608' (YYMM of starts_on + optional suffix; app generates)
  title text not null,
  event_type text not null check (event_type in
    ('fahui', 'gongxiu', 'foxueban', 'fangsheng', 'xingquban', 'other')),  -- 法会/共修/佛学班/放生/兴趣班/其他
  organizing_centre_id uuid not null references public.centres(id),
  co_centre_ids uuid[] not null default '{}',      -- 联办中心 (informational)
  starts_on date not null,
  ends_on date,                                    -- null = single-day
  location text,
  capacity int,                                    -- null = unlimited
  reg_deadline date,
  requires_approval boolean not null default true,
  description text,
  status text not null default 'draft' check (status in
    ('draft', 'open', 'full', 'closed', 'completed')),
  created_at timestamptz not null default now(),
  created_by uuid references public.volunteers(id),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.volunteers(id)
);
create index idx_events_starts_on on public.events(starts_on desc);
create index idx_events_organizing_centre on public.events(organizing_centre_id);
create index idx_events_status on public.events(status);


-- ── (b) event_fees — one row per ENABLED fee item on an event ────────────────────────
create table public.event_fees (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  item text not null check (item in
    ('registration', 'meal', 'accommodation', 'transfer', 'uniform', 'other')),
  label_cn text,                                   -- optional display override (esp. 'other')
  amount numeric(8, 2) not null check (amount >= 0),
  billing text not null check (billing in ('per_person', 'per_day', 'per_night', 'per_item')),
  sort int not null default 0,
  unique (event_id, item)
);


-- ── (c) event_team_needs — how many of each volunteer team an event needs ────────────
create table public.event_team_needs (
  event_id uuid not null references public.events(id) on delete cascade,
  team_id uuid not null references public.teams(id),
  needed int not null check (needed > 0),
  primary key (event_id, team_id)
);


-- ── (d) registrations — one per applicant per event (member or Phase C newcomer) ─────
create table public.registrations (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id),
  reg_no text not null unique,                     -- 'XLFM-2608-0412' (app: event code + zero-padded seq)
  member_id uuid references public.members(id),    -- nullable BY DESIGN: Phase C newcomers
  applicant_name text,                             -- raw submission identity (C); B admin flow sets member_id
  applicant_phone text,
  constraint reg_identity check (member_id is not null or applicant_name is not null),
  volunteer_team_id uuid references public.teams(id),  -- 义工组 (null = 信众参加)
  selections jsonb not null default '{}',          -- {"meal_days":3,"nights":2,"transfer":true,"uniform":{"size":"M","qty":1}}
  fee_total numeric(10, 2) not null default 0,
  fee_breakdown jsonb not null default '[]',       -- SNAPSHOT [{item,label,amount,qty,subtotal}] locked at submission
  status text not null default 'pending' check (status in
    ('pending', 'approved', 'rejected', 'cancelled')),
  decided_by uuid references public.volunteers(id),
  decided_at timestamptz,
  rejected_reason text,
  notes text,
  created_at timestamptz not null default now(),
  created_by uuid references public.volunteers(id),  -- null for future public (Phase C) submissions
  updated_at timestamptz not null default now(),
  updated_by uuid references public.volunteers(id)
);
create index idx_registrations_event_status on public.registrations(event_id, status);
create index idx_registrations_member on public.registrations(member_id);
create index idx_registrations_applicant_phone on public.registrations(applicant_phone);


-- ── (e) RLS — enable on all four; SELECT-only, composed events-module + centre scope ─
-- Writes stay service-role-only (no INSERT/UPDATE/DELETE policies). fees/needs/regs
-- inherit their event's organizing_centre_id via an EXISTS join.
alter table public.events           enable row level security;
alter table public.event_fees       enable row level security;
alter table public.event_team_needs enable row level security;
alter table public.registrations    enable row level security;

create policy "events module can read events" on public.events
  for select to authenticated
  using (
    public.has_module_access('events','view')
    and public.centre_scope_allows(organizing_centre_id)
  );

create policy "events module can read event_fees" on public.event_fees
  for select to authenticated
  using (
    public.has_module_access('events','view')
    and exists (
      select 1 from public.events e
       where e.id = event_fees.event_id
         and public.centre_scope_allows(e.organizing_centre_id)
    )
  );

create policy "events module can read event_team_needs" on public.event_team_needs
  for select to authenticated
  using (
    public.has_module_access('events','view')
    and exists (
      select 1 from public.events e
       where e.id = event_team_needs.event_id
         and public.centre_scope_allows(e.organizing_centre_id)
    )
  );

create policy "events module can read registrations" on public.registrations
  for select to authenticated
  using (
    public.has_module_access('events','view')
    and exists (
      select 1 from public.events e
       where e.id = registrations.event_id
         and public.centre_scope_allows(e.organizing_centre_id)
    )
  );
