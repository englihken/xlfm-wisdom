# Database Migrations

These SQL files document the Supabase (Postgres) schema for xlfm-wisdom, in the
order it was built. They exist so the database is reproducible and travels with
the code for handover.

## How to use

Run the files in **numeric order** to rebuild the database in a new environment
(e.g. a fresh Supabase project) — paste each into the Supabase SQL Editor, or
apply them with `psql`, lowest number first:

1. `001_conversations_messages.sql` — `conversations` + `messages` tables
2. `002_contacts_and_journey.sql` — `contacts` layer + journey fields, and
   adds `contact_id` / `summary` / `assigned_volunteer` / `retain` to `conversations`
3. `003_enable_rls.sql` — enables Row Level Security (tables locked to the
   `service_role` key used by the backend; volunteer-access policies come in Phase 3)
4. `004_volunteer_read_policies.sql` — Phase 3: adds RLS `select` policies so
   logged-in volunteers (the `authenticated` role) can read `contacts`,
   `conversations`, and `messages`; the public `anon` role stays blocked

## Note

The **live database already has 001–003 applied.** `004` is the latest and must
still be run in Supabase. These files are for documentation, reproducibility, and
rebuilding a new environment — not something to re-run once applied.
