-- 017_event_meal_slots.sql
-- =====================================================================================
-- PURPOSE (ERP task C0 — per-day-per-meal registration grid).
--   Replaces the coarse "meal_days" model with a per-day-per-meal offering + selection
--   model that matches the org's 2019 paper form. Two changes:
--
--     (a) event_meal_slots — one row per (event, date, meal). The kitchen marks which
--         cells it OFFERS (offered=true default). Registrations then pick from the
--         offered cells (selections.meals = ['YYYY-MM-DD:breakfast', …]); the meal fee
--         may bill per_item (每餐) against that count. A slot is (event_id, date, meal);
--         the app maintains the grid from each event's [starts_on, ends_on] range.
--
--     (b) events.reg_edit_cutoff_days — how many days before starts_on a registrant may
--         still edit their selections (default 3). The new selections-edit route gates
--         on today < starts_on − reg_edit_cutoff_days.
--
--   Legacy events keep meal billing per_day (qty = selections.meal_days) and compute
--   EXACTLY as before — this migration only ADDS; it changes no existing row.
--
--   Writes stay service-role-only (NO write policies); audit is app-level via writeAudit.
--   event_meal_slots reads compose the SAME two-dimension gate as 016's event children:
--   has_module_access('events','view') AND (EXISTS events join with centre_scope_allows).
--
-- APPLY MANUALLY (Supabase SQL Editor). Run docs/erp/10-c0-verification.md PREFLIGHT
--   first; STOP on any deviation. Apply this BEFORE deploying the C0 code (the app reads
--   event_meal_slots and events.reg_edit_cutoff_days).
--
-- ROLLBACK (manual — dropping the table drops its RLS policy):
--   drop table if exists public.event_meal_slots;
--   alter table public.events drop column if exists reg_edit_cutoff_days;
-- =====================================================================================


-- ── (a) event_meal_slots — the kitchen's per-day-per-meal offering grid ──────────────
create table public.event_meal_slots (
  event_id uuid not null references public.events(id) on delete cascade,
  slot_date date not null,
  meal text not null check (meal in ('breakfast', 'lunch', 'dinner')),  -- 早/午/晚
  offered boolean not null default true,           -- kitchen toggles; false = not served
  primary key (event_id, slot_date, meal)
);


-- ── (b) reg_edit_cutoff_days — selections editable until starts_on − N days ───────────
alter table public.events
  add column reg_edit_cutoff_days int not null default 3 check (reg_edit_cutoff_days >= 0);


-- ── (c) RLS — SELECT-only, composed events-module + centre scope (016 pattern) ───────
-- Writes stay service-role-only (no INSERT/UPDATE/DELETE policy). Slots inherit their
-- event's organizing_centre_id via an EXISTS join, exactly like event_fees et al.
alter table public.event_meal_slots enable row level security;

create policy "events module can read event_meal_slots" on public.event_meal_slots
  for select to authenticated
  using (
    public.has_module_access('events','view')
    and exists (
      select 1 from public.events e
       where e.id = event_meal_slots.event_id
         and public.centre_scope_allows(e.organizing_centre_id)
    )
  );
