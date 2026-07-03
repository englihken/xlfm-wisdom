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
5. `005_conversation_category.sql` — Phase 3: adds `category` + `crisis_flag`
   columns to `conversations` for automatic categorisation
6. `006_volunteers.sql` — Phase 3 (user management): the `volunteers` table
   (RLS enabled, no policies — service-role access only). Documents the schema;
   the table and its bootstrap rows (existing users + first admin) were created
   manually in Supabase, so there is no seed data to re-run.
7. `007_volunteer_center.sql` — Phase 3 (user management): adds a nullable
   `center` (所属中心) column to `volunteers`
8. `008_summarized_at.sql` — Phase 3 (auto-summary cron): adds a nullable
   `summarized_at` column to `conversations` (NULL = not yet folded into the
   contact's care summary; drives the daily `/api/cron/summarize` job)

## Note

`006`'s table and its bootstrap rows (existing users + first admin) were **already
created manually** in the live Supabase project — do not re-run it there. These
files are for documentation, reproducibility, and rebuilding a new environment,
not something to re-run once applied.
