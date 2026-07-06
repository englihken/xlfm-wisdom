-- 018_public_registration.sql
-- =====================================================================================
-- PURPOSE (ERP task C1 — public, login-free self-registration; BACKEND ONLY).
--   Lets an event be opened to a public, anonymous registration form reachable at a
--   per-event unguessable URL (/r/<token>, UI in C2). A member self-identifies by
--   phone (silent server-side match) or a newcomer submits applicant_name/phone; the
--   submission lands in the SAME approval queue as staff 代报名 (always 'pending').
--   NO member is created here — 建档 stays on the staff approval decision (Phase B/C).
--
--   Two new columns on events form the public gate. Being status='open' is NOT enough:
--   the public form accepts a submission ONLY when ALL THREE hold —
--       public_registration_enabled = true   (admin explicitly opened the form)
--     AND public_token IS NOT NULL            (the unguessable slug exists)
--     AND status = 'open'                     (registration window is live)
--   The application enforces this composition in src/lib/public-event.ts (loadPublicEvent);
--   a bad / disabled / closed token is indistinguishable from not-found (404) so the
--   surface leaks no enumeration signal.
--
--   RLS — DELIBERATELY NO NEW POLICIES.
--     The public API is served by the app's service-role client (supabaseAdmin) sitting
--     BEHIND the app's own token+enabled+open gate — it NEVER uses the anon Postgres role,
--     and it only ever runs a narrow whitelist of column-scoped queries (this event + its
--     own registration). Adding an `anon`/`public`-role SELECT policy would widen the
--     Postgres attack surface for no benefit and is intentionally avoided. Writes stay
--     service-role-only exactly like the rest of the platform (016/017). Audit is
--     app-level via writeAudit (actor_email='public', actor_id=null).
--
--   ABUSE GUARD (light, DB-level): a partial unique index stops the SAME newcomer phone
--   registering the SAME event twice while still pending/approved (member_id null path).
--   Matched-member duplicates are caught app-side by the existing (event, member) check.
--
-- APPLY MANUALLY (Supabase SQL Editor). Run docs/erp/11-c1-verification.md PREFLIGHT
--   first; STOP on any deviation. Apply this BEFORE deploying the C1 code (the public
--   routes and the staff PATCH read events.public_registration_enabled / public_token).
--
-- ROLLBACK (manual — dropping the column drops its unique index automatically):
--   drop index if exists public.registrations_public_dupe;
--   alter table public.events drop column if exists public_token;              -- drops its unique index
--   alter table public.events drop column if exists public_registration_enabled;
-- =====================================================================================


-- ── (a) events: the public-form gate columns ─────────────────────────────────────────
-- public_registration_enabled — admin must explicitly open the public form (fail-closed).
-- public_token — unguessable urlsafe slug for /r/<token>; NULL until first enabled. Unique
--   so a token maps to exactly one event; the app reuses the same token if re-enabled.
alter table public.events
  add column public_registration_enabled boolean not null default false,
  add column public_token text unique;


-- ── (b) NO new RLS policies (see header). Public reads/writes go through the app's
--         service-role client behind the token+enabled+open gate, never the anon role. ──


-- ── (c) light abuse guard — one pending/approved public (newcomer) reg per phone/event ─
-- Scoped to member_id IS NULL (the newcomer path); matched members are guarded app-side by
-- the existing (event_id, member_id, status in pending|approved) check. cancelled/rejected
-- rows are excluded so a phone can re-register after a prior submission was closed out.
create unique index registrations_public_dupe
  on public.registrations (event_id, applicant_phone)
  where member_id is null and status in ('pending', 'approved');
