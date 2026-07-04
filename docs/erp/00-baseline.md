# ERP Baseline — xlfm-wisdom (Discovery Only)

**Generated:** 2026-07-04 · **Scope:** read-only introspection. No schema, migration, or DB changes made. This is the only file created.

## Method & source authority

1. **Primary source: SQL migrations** in `migrations/` (NOT `supabase/migrations/` — the repo keeps them at the top level). Files `001`–`012` + `README.md`. They are applied **manually** in the Supabase SQL Editor (per `migrations/README.md`); some rows (`volunteers`, first admin) were bootstrapped by hand and are **not** in any migration.
2. **DB types file:** UNKNOWN / none found. No `database.types.ts`, no `supabase gen types` output anywhere in the repo.
3. **Live DB introspection:** **NOT performed.** There is no `supabase/config.toml` (CLI not linked), the Supabase CLI is not installed locally, and no read-only DB connection is available from this environment. The introspection SQL in the task was **not run**. Everything below is reconciled from migrations + application code. Anywhere the live DB could differ from migrations (manual edits, hand-run ALTERs, actual seeded rows) is flagged **UNKNOWN — needs Ken to check** with the exact query to run.

> To fill the UNKNOWNs, run the task's introspection SQL against the project (Supabase SQL Editor works) and reconcile.

---

## 1. TABLES

Five tables in `public`, all in the **care wing** except `volunteers` (shared infra). There is **no** centres table, no members/events/finance/duty tables (see §4, §9).

Wing tag: 🏥 = care wing · 🔧 = shared infrastructure.

### 🏥 `contacts` — `migrations/002_contacts_and_journey.sql`
```sql
create table contacts (
  id uuid primary key default gen_random_uuid(),
  channel text not null default 'web',
  wa_id text,
  browser_id text,
  display_name text,
  stage text default '初次接触',
  summary text,
  notes text,
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now()
);
create unique index idx_contacts_wa on contacts(wa_id) where wa_id is not null;
create unique index idx_contacts_browser on contacts(browser_id) where browser_id is not null;
```
- **PK:** `id` (uuid, `gen_random_uuid()`).
- **Unique:** partial unique on `wa_id` (where not null); partial unique on `browser_id` (where not null).
- **FKs:** none out. Referenced by `conversations.contact_id`.
- **Indexes:** the two partial unique indexes above.

### 🏥 `conversations` — created in `001`, extended in `002`, `005`, `008`
```sql
-- 001_conversations_messages.sql
create table conversations (
  id uuid primary key default gen_random_uuid(),
  channel text not null default 'web',
  status text not null default 'ai_handling',
  language text default 'zh',
  created_at timestamptz not null default now(),
  last_message_at timestamptz not null default now()
);
create index idx_conversations_recent on conversations(last_message_at desc);

-- 002_contacts_and_journey.sql
alter table conversations
  add column contact_id uuid references contacts(id) on delete cascade,
  add column summary text,
  add column assigned_volunteer uuid,          -- NB: plain uuid, NOT a FK (see §9)
  add column retain boolean not null default false;
create index idx_conversations_contact on conversations(contact_id);

-- 005_conversation_category.sql
alter table conversations add column category text;
alter table conversations add column crisis_flag boolean not null default false;

-- 008_summarized_at.sql
alter table conversations add column summarized_at timestamptz;
```
- **Columns (assembled):** `id`, `channel` (def `'web'`), `status` (def `'ai_handling'`), `language` (def `'zh'`), `created_at` (def `now()`), `last_message_at` (def `now()`), `contact_id`, `summary`, `assigned_volunteer`, `retain` (def `false`), `category`, `crisis_flag` (def `false`), `summarized_at`.
- **PK:** `id`.
- **FKs:** `contact_id` → `contacts(id)` ON DELETE CASCADE. **`assigned_volunteer` is a bare `uuid` with NO foreign key** (should logically reference `volunteers(id)` — see §9 Risks).
- **Indexes:** `idx_conversations_recent (last_message_at desc)`, `idx_conversations_contact (contact_id)`.
- **No CHECK constraint on `status`** — free text. Values used by code: `ai_handling`, `volunteer_handling`, `needs_human`, `human_handling`, `resolved`, `closed` (see `src/app/dashboard/page.tsx` `STATUS_LABELS`; `volunteer_handling` is the live one, `human_handling` is legacy/unused).

### 🏥 `messages` — created in `001`, extended in `010`, `012`
```sql
-- 001_conversations_messages.sql
create table messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations(id) on delete cascade,
  role text not null,
  content text not null,
  sources jsonb,
  created_at timestamptz not null default now()
);
create index idx_messages_conversation on messages(conversation_id, created_at);

-- 010_wa_message_id.sql
alter table messages add column wa_message_id text;
create unique index idx_messages_wa_message_id
  on messages(wa_message_id) where wa_message_id is not null;

-- 012_message_sent_by.sql
alter table messages add column sent_by uuid references volunteers(id);
```
- **Columns:** `id`, `conversation_id`, `role`, `content`, `sources` (jsonb), `created_at` (def `now()`), `wa_message_id`, `sent_by`.
- **PK:** `id`.
- **FKs:** `conversation_id` → `conversations(id)` ON DELETE CASCADE; `sent_by` → `volunteers(id)` (no ON DELETE clause → default NO ACTION).
- **Unique:** partial unique on `wa_message_id` (where not null) — WhatsApp inbound dedup.
- **Indexes:** `idx_messages_conversation (conversation_id, created_at)`, plus the wa_message_id partial unique.
- **No CHECK on `role`** — free text. Values used by code: `user`, `assistant`, `volunteer`.

### 🔧 `volunteers` — created in `006`, extended in `007`, `009` (SHARED INFRA — the auth/accounts table)
```sql
-- 006_volunteers.sql
create table volunteers (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  display_name text,
  role text not null default 'volunteer' check (role in ('admin', 'volunteer')),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- 007_volunteer_center.sql
alter table volunteers add column center text;    -- free text (see §4)

-- 009_volunteer_profile.sql
alter table volunteers add column must_change_password boolean not null default false;
alter table volunteers add column occupation text;
alter table volunteers add column skills text;
```
- **Columns:** `id`, `email` (not null), `display_name`, `role` (def `'volunteer'`, CHECK in `admin|volunteer`), `active` (def `true`), `created_at` (def `now()`), `center`, `must_change_password` (def `false`), `occupation`, `skills`.
- **PK:** `id` = `auth.users(id)` (1:1 with a Supabase Auth account).
- **FKs:** `id` → `auth.users(id)` ON DELETE CASCADE.
- **CHECK:** `role in ('admin','volunteer')`.
- **Unique:** **only the PK.** ⚠️ **No unique constraint on `email`** — duplicate emails are not prevented at the DB level (see §9).
- **Indexes:** PK only (no extra indexes declared).

### 🏥 `conversation_reads` — `migrations/011_last_read.sql` (per-volunteer unread tracking)
```sql
create table conversation_reads (
  volunteer_id uuid not null references volunteers(id) on delete cascade,
  conversation_id uuid not null references conversations(id) on delete cascade,
  last_read_at timestamptz not null default now(),
  primary key (volunteer_id, conversation_id)
);
```
- **PK:** composite `(volunteer_id, conversation_id)`.
- **FKs:** `volunteer_id` → `volunteers(id)` ON DELETE CASCADE; `conversation_id` → `conversations(id)` ON DELETE CASCADE.
- **Indexes:** the composite PK (covers `volunteer_id`-prefixed lookups).

> **Summaries:** there is no separate `summaries` table. The evolving care summary lives in `contacts.summary` (per-contact) and `conversations.summary` (per-conversation, currently unused). Written by the cron job (§7).

**UNKNOWN — needs Ken to check:** whether any table/column/index was added or altered directly in Supabase outside these migrations. Verify with:
`select table_name, column_name, data_type, is_nullable, column_default from information_schema.columns where table_schema='public' order by table_name, ordinal_position;`

---

## 2. RLS (Row Level Security)

RLS is enabled on all five tables. Policies exist on only three (the care read tables); `volunteers` and `conversation_reads` have RLS enabled with **no policies** (service-role-only). Every app read/write actually goes through the **service-role key** (`supabaseAdmin`), which **bypasses RLS entirely** — so these policies are defense-in-depth, not the primary gate.

### `contacts` — RLS ON
Enabled: `migrations/003_enable_rls.sql` → `alter table contacts enable row level security;`
Policy (`migrations/004_volunteer_read_policies.sql`), **verbatim**:
```sql
create policy "volunteers can read contacts" on contacts
  for select to authenticated using (true);
```

### `conversations` — RLS ON
Enabled: `003` → `alter table conversations enable row level security;`
Policy (`004`), **verbatim**:
```sql
create policy "volunteers can read conversations" on conversations
  for select to authenticated using (true);
```

### `messages` — RLS ON
Enabled: `003` → `alter table messages enable row level security;`
Policy (`004`), **verbatim**:
```sql
create policy "volunteers can read messages" on messages
  for select to authenticated using (true);
```

### `volunteers` — RLS ON, **no policies**
`migrations/006_volunteers.sql` → `alter table volunteers enable row level security;` (comment: "Locked to the service_role key only (no policies granted)").

### `conversation_reads` — RLS ON, **no policies**
`migrations/011_last_read.sql` → `alter table conversation_reads enable row level security;`

**Summary table:**

| Table | RLS | Policies |
|---|---|---|
| contacts | ON | 1 × `SELECT` / `authenticated` / `USING (true)` / no `WITH CHECK` |
| conversations | ON | 1 × `SELECT` / `authenticated` / `USING (true)` / no `WITH CHECK` |
| messages | ON | 1 × `SELECT` / `authenticated` / `USING (true)` / no `WITH CHECK` |
| volunteers | ON | none |
| conversation_reads | ON | none |

- No `INSERT`/`UPDATE`/`DELETE` policies exist anywhere → non-service-role clients can only ever read (contacts/conversations/messages), never write.
- The three `USING (true)` policies grant **every authenticated user unrestricted SELECT** on all care data — see §9 (the two-wing separation risk).

**UNKNOWN — needs Ken to check:** whether extra policies were added directly in Supabase. Verify with:
`select * from pg_policies where schemaname='public' order by tablename, policyname;`
and `select tablename, rowsecurity from pg_tables where schemaname='public';`

---

## 3. AUTH & ROLES

### Accounts table
`volunteers` (§1) is the accounts table — one row per dashboard user, PK = `auth.users(id)`. Supabase Auth (email + password) holds the credential; the `volunteers` row holds app identity (`role`, `active`, profile).

### Exact role values
- **Schema constraint:** `role text not null default 'volunteer' check (role in ('admin', 'volunteer'))` (`006`). So the DB permits **exactly two** values: `admin`, `volunteer`.
- **Application `Role` type:** `'admin' | 'volunteer'` — `src/lib/supabase-server.ts:56`, `src/app/dashboard/page.tsx:152`.
- **Seed/migration data:** none in migrations — rows (incl. first admin) were bootstrapped **manually** in the Supabase SQL Editor (`006` note). **UNKNOWN — needs Ken to check** which values are actually present in live rows: `select distinct role, count(*) from volunteers group by role;` (the CHECK guarantees only `admin`/`volunteer` are possible).

### How `auth.uid()` maps to a volunteer row
Server-side, via the service-role client, keyed on `id`. `src/lib/supabase-server.ts`:
```ts
export async function getAuthenticatedUser(): Promise<User | null> {
  const supabase = await createSupabaseServerClient();      // ANON key, reads session from cookies
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;
  return data.user;
}

export async function getActiveVolunteer(): Promise<{ user: User; volunteer: Volunteer } | null> {
  const user = await getAuthenticatedUser();
  if (!user) return null;
  if (!supabaseAdmin) return null;
  const { data, error } = await supabaseAdmin
    .from('volunteers')
    .select('id, email, display_name, role, active, must_change_password')
    .eq('id', user.id)                 // auth.uid()  ==  volunteers.id
    .maybeSingle();
  if (error) { console.error('[auth] volunteer lookup failed:', error); return null; }
  if (!data || !data.active) return null;   // inactive → treated as no access
  return { user, volunteer: data as Volunteer };
}
```
So: cookie session → `auth.getUser()` (ANON client) → `volunteers.id = user.id` lookup via service role. Access requires the row to exist **and** `active = true`.

### Where role checks happen today
**No middleware, no RLS-based role logic** (RLS policies are role-agnostic `USING (true)`). Role is enforced two ways:

**Server-side (authoritative), pattern `if (access.volunteer.role !== 'admin') return 403`:**
- `src/app/api/dashboard/volunteers/route.ts:39, 70` (GET/POST list + create)
- `src/app/api/dashboard/volunteers/[id]/route.ts:44` (PATCH)
- `src/app/api/dashboard/reports/route.ts:48`
- `src/app/api/dashboard/conversations/[id]/handback/route.ts:44` (assignee OR admin)
- Body-validation of the `role` field: `volunteers/route.ts:98`, `volunteers/[id]/route.ts:118`

**Client-side (UI reveal only, not security):**
- `src/components/dashboard-nav.tsx:102` — filters admin-only nav items
- `src/app/dashboard/settings/page.tsx:134` — admin gate for the settings page
- `src/app/dashboard/reports/page.tsx:96` — admin gate for reports
- `src/app/dashboard/page.tsx:666` — passes `isAdmin` to the thread header

Every active-volunteer gate (401/403) lives in `getActiveVolunteer()` called at the top of each `src/app/api/dashboard/**/route.ts` handler.

### JWT custom claims / app_metadata
**None.** No references to `app_metadata`, custom claims, `raw_app_meta`, or `setSession` anywhere in `src/`. Role lives solely in the `volunteers.role` column, read server-side.

### Service-role key — confirmed server-side only
`SUPABASE_SERVICE_ROLE_KEY` is read in **exactly one place**: `src/lib/supabase.ts:4`, which builds `supabaseAdmin` with a `// Never import this into client components.` note. Every importer of `@/lib/supabase` is a server route handler (`src/app/api/**/route.ts`) — **none** carry `'use client'` (verified). Full list of importers:
`api/chat/route.ts`, `api/chat/updates/route.ts`, `api/cron/summarize/route.ts`, `api/dashboard/contacts/[id]/route.ts`, `api/dashboard/conversations/route.ts`, `api/dashboard/conversations/[id]/{route,handback,read,reply,takeover}.ts`, `api/dashboard/me/change-password/route.ts`, `api/dashboard/reports/route.ts`, `api/dashboard/volunteers/route.ts`, `api/dashboard/volunteers/[id]/route.ts`, `api/webhooks/whatsapp/route.ts`.

---

## 4. CENTRES

⚠️ **There is NO centres table in the database.** Centres are a **hardcoded TypeScript constant**, and a volunteer's centre is a nullable free-text column (`volunteers.center`, `migrations/007`) validated against that constant at write time.

Source: `src/lib/xlfm-centers.ts`
```ts
export const XLFM_CENTERS: XlfmCenterGroup[] = [
  { state: '吉隆坡', centers: ['总会 HQ', '蕉赖 Cheras'] },
  { state: '雪兰莪', centers: ['蒲种 Puchong', '八打灵再也 Petaling Jaya', '巴生 Klang', '瓜拉雪兰莪 Kuala Selangor'] },
  { state: '柔佛',   centers: ['古来 Kulai', '士姑来 Skudai', '乌鲁地南 Ulu Tiram', '峇株巴辖 Batu Pahat', '永平 Yong Peng', '麻坡 Muar', '昔加末 Segamat', '居銮 Kluang'] },
  { state: '东海岸', centers: ['关丹 Kuantan', '而连突 Jerantut', '瓜拉登嘉楼 Kuala Terengganu', '哥打巴鲁 Kota Bharu'] },
  { state: '马六甲', centers: ['马六甲 Melaka'] },
  { state: '吉打',   centers: ['亚罗士打 Alor Setar', '双溪大年 Sungai Petani'] },
  { state: '森美兰', centers: ['芙蓉 Seremban'] },
  { state: '霹雳',   centers: ['怡保 Ipoh', '安顺 Teluk Intan', '实兆远 Sitiawan', '太平 Taiping'] },
  { state: '沙巴',   centers: ['亚庇 Kota Kinabalu', '山打根 Sandakan', '斗湖 Tawau'] },
  { state: '砂拉越', centers: ['古晋 Kuching', '诗巫 Sibu', '美里 Miri'] },
  { state: '槟城',   centers: ['威南 Simpang Ampat', '槟岛 Bayan Lepas', '北海 Butterworth'] },
];
export const XLFM_CENTER_VALUES: readonly string[] = XLFM_CENTERS.flatMap((g) => g.centers);
export function isValidCenter(value: string): boolean { return XLFM_CENTER_VALUES.includes(value); }
```
- **Stored value:** the full bilingual label string (e.g. `"怡保 Ipoh"`), not a code. There are **no short codes** in the data model.
- **Validation:** `isValidCenter()` is called server-side in `src/app/api/dashboard/volunteers/route.ts` and `.../[id]/route.ts` (unknown value → 400). Legacy free-text centres persist and display but won't preselect.

### Mapping the legacy Excel codes
| Excel code | Present in `XLFM_CENTERS`? | Label |
|---|---|---|
| IPOH | ✅ | `怡保 Ipoh` (霹雳) |
| ULU TIRAM | ✅ | `乌鲁地南 Ulu Tiram` (柔佛) |
| BRUNEI | ❌ **NOT present** | — |

⚠️ **BRUNEI is not in the list** (the list is Malaysia-only; no Brunei/overseas centres). The ERP centre mapping will need either (a) a real `centres` table seeded from this constant **plus** the missing codes (BRUNEI, any other overseas), or (b) an extension of the constant. **UNKNOWN — needs Ken to check** the full authoritative Excel centre-code list so nothing is dropped.

---

## 5. NAV RAIL

- **Component:** `src/components/dashboard-nav.tsx` (single shared rail; `'use client'`).
- **Consumers:** rendered by `src/app/dashboard/page.tsx`, `src/app/dashboard/reports/page.tsx`, `src/app/dashboard/settings/page.tsx` as `<DashboardNav role={...} active={...} />`.

### How a module registers a nav item
There is **no registry / plugin mechanism** — items are a hardcoded array literal inside the component. Adding an ERP module = editing this array (and the `NavKey` union + adding an icon):
```tsx
// src/components/dashboard-nav.tsx
export type NavKey = 'inbox' | 'reports' | 'settings';

const ITEMS: NavItem[] = [
  { key: 'inbox',    label: '收件箱', href: '/dashboard',          Icon: InboxIcon, adminOnly: false },
  { key: 'reports',  label: '报表',   href: '/dashboard/reports',  Icon: ChartIcon, adminOnly: true  },
  { key: 'settings', label: '设置',   href: '/dashboard/settings', Icon: GearIcon,  adminOnly: true  },
];

export function DashboardNav({ role, active }: { role: Role; active: NavKey }) {
  const items = ITEMS.filter((i) => !i.adminOnly || role === 'admin');   // permission gate
  // ...renders a 72px fixed rail (desktop) / horizontal row (<768px)
}
```

### How items are permission-gated
Only a boolean `adminOnly` per item, filtered against the `role` prop: `!i.adminOnly || role === 'admin'`. Two levels only (admin vs everyone). No per-module / per-centre / feature-flag gating exists. `role` is passed in by each page from its `/me` fetch, e.g. `role={me?.role ?? 'volunteer'}`. **This is UI-only; the real gate is the server-side role check in each API route (§3).**

---

## 6. FIRST-LOGIN FLOW (forced password change)

Reusable as-is for the ERP admin account. Three pieces:

1. **Flag column:** `volunteers.must_change_password boolean not null default false` (`migrations/009`). Set `true` when an admin creates an account: `src/app/api/dashboard/volunteers/route.ts` inserts the row with `must_change_password: true`.
2. **Gate component:** `src/components/password-change-gate.tsx` — full-screen blocking form (`'use client'`). Rendered by both `src/app/dashboard/page.tsx` and `src/app/dashboard/settings/page.tsx` when `/me` reports `mustChangePassword === true`; on success it calls `onDone()` and the app continues in the **same session**.
3. **Endpoint:** `src/app/api/dashboard/me/change-password/route.ts` (`POST { newPassword }`) — auth-gated to the caller (`getActiveVolunteer`, id from session, never a body field). Min 8 chars. Rejects reusing the current password via a throwaway anon-client `signInWithPassword` probe (fail-**open** if the probe errors). Updates the auth password via `supabaseAdmin.auth.admin.updateUserById(...)`, then clears `must_change_password` to `false`.

`/api/dashboard/me` returns `mustChangePassword` (from the `volunteers` row) so the client knows to render the gate.

---

## 7. STORAGE & CRON

### Supabase Storage
**None.** No Storage buckets are created or referenced anywhere in code (`.storage` / `bucket` matches are only chart-"bucketing" comments). No bucket policies exist in migrations. **UNKNOWN — needs Ken to check** whether any bucket exists in the Supabase project outside the repo: Storage tab, or `select id, name, public from storage.buckets;`.

### Vercel Cron
`vercel.json` — one job:
```json
{ "crons": [ { "path": "/api/cron/summarize", "schedule": "0 16 * * *" } ] }
```
- **Job:** `src/app/api/cron/summarize/route.ts` (`GET`, `runtime='nodejs'`, `maxDuration=60`). Auth via `Authorization: Bearer ${CRON_SECRET}`. Once a conversation is idle 2h+, folds it into `contacts.summary` via one Claude call; idempotent via `conversations.summarized_at`. Has a 45s time-budget guard + `BATCH_LIMIT=12`.
- **Schedule:** `0 16 * * *` = 16:00 UTC daily = **00:00 MYT** (Asia/Kuala_Lumpur, UTC+8).

### Edge Functions
**None.** No `supabase/functions/` directory (no `supabase/` dir at all).

---

## 8. ENV VARS (names only — no values)

From `.env.example` (4 lines) **plus** code references. **No values shown.**

| Variable | Declared in `.env.example` | Referenced in code (file) | Purpose |
|---|---|---|---|
| `ANTHROPIC_API_KEY` | ✅ | `src/lib/care-pipeline.ts`, `src/app/api/chat/route.ts`, `src/app/api/cron/summarize/route.ts` | Claude API |
| `PINECONE_API_KEY` | ✅ | `src/lib/vector-search.ts` (+ scripts) | Vector DB |
| `PINECONE_INDEX_NAME` | ❌ | `src/lib/vector-search.ts` | Pinecone index name |
| `VOYAGE_API_KEY` | ✅ | *(not found in `src/`)* — scripts/legacy only? | Embeddings (unused in app?) |
| `NEXT_PUBLIC_SITE_URL` | ✅ | *(not found in `src/` via grep)* | Public site URL (possibly unused) |
| `NEXT_PUBLIC_SUPABASE_URL` | ❌ | `src/lib/supabase.ts`, `supabase-server.ts`, `supabase-browser.ts`, `me/change-password/route.ts` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | ❌ | `src/lib/supabase-server.ts`, `supabase-browser.ts`, `me/change-password/route.ts` | Supabase anon key (client/session) |
| `SUPABASE_SERVICE_ROLE_KEY` | ❌ | `src/lib/supabase.ts` **only** | Service-role key (server-only, §3) |
| `CRON_SECRET` | ❌ | `src/app/api/cron/summarize/route.ts` | Cron bearer auth |
| `WHATSAPP_VERIFY_TOKEN` | ❌ | `src/lib/whatsapp.ts`, `api/webhooks/whatsapp/route.ts` | WA webhook handshake |
| `WHATSAPP_ACCESS_TOKEN` | ❌ | `src/lib/whatsapp.ts` | WA Cloud API token |
| `WHATSAPP_PHONE_NUMBER_ID` | ❌ | `src/lib/whatsapp.ts` | WA sender id |

⚠️ **`.env.example` is stale/incomplete** — it omits every Supabase var, `CRON_SECRET`, `PINECONE_INDEX_NAME`, and all three `WHATSAPP_*` vars that the code requires. **UNKNOWN — needs Ken to check** the actual configured env (Vercel + local `.env.local`) — do not print values.

---

## 9. RISKS FOR ERP EXTENSION

1. **🔴 Broad SELECT to all authenticated users (the two-wing separation risk).** `contacts`, `conversations`, `messages` each have `for select to authenticated using (true)` (§2). Today only volunteers authenticate, and the app reads via service-role anyway — but the moment ERP users (会员/staff) authenticate against the **same Supabase project**, they inherit **unrestricted read of all care data** (sensitive counselling conversations, crisis flags). Before adding an ERP auth surface, decide: separate Supabase project, or tighten these policies to scope by role/wing (e.g. `using ((auth.jwt() ->> 'role') = 'care')` or a `volunteers`-join predicate). This is the single biggest thing to resolve first.

2. **🟠 One flat accounts table + two-value role.** `volunteers` (CHECK `admin|volunteer`) is the only identity table, and `role` is binary. An ERP wing needs finer permissions (finance vs duty vs membership admin). Options: extend the CHECK/enum, add a roles/permissions table, or a per-module grant table. Note the table is literally named `volunteers` — an ERP "member/staff" concept may not fit that name cleanly.

3. **🟠 `conversations.assigned_volunteer` is NOT a foreign key.** It's a bare `uuid` (`migrations/002`) — no referential integrity to `volunteers`. If ERP work touches assignment or reuses this pattern, add the FK (and be aware existing data may contain orphan ids). **UNKNOWN — needs Ken to check** for orphans before adding the constraint.

4. **🟠 No unique constraint on `volunteers.email`.** Duplicate accounts per email are possible at the DB level (only `auth.users` enforces email uniqueness upstream). ERP onboarding flows should not assume email is unique in `volunteers`.

5. **🟡 No name collisions yet — clean namespace for ERP tables.** There is **no** `members`, `events`, `finance`, `duty`, `centres`, or `accounts` table. Those names are free to claim. But **centres do not exist as a table at all** (§4) — they're a TS constant, Malaysia-only, missing BRUNEI. ERP will need a real `centres` table; seed it carefully and reconcile with the legacy Excel codes (get the full list from Ken).

6. **🟡 Migrations are manual & hand-bootstrapped.** No Supabase CLI link, no migration runner, no `schema.sql` snapshot, some rows inserted by hand. Live DB may drift from `migrations/`. Recommend capturing a real introspection snapshot (run the task's SQL) before writing ERP migrations, and consider adopting `supabase/migrations/` + CLI so ERP changes are reproducible.

7. **🟡 No RLS write policies + service-role-everywhere pattern.** All writes go through `supabaseAdmin` behind server-side auth gates. Consistent and safe, but it means RLS is effectively **off for the app** — every new ERP endpoint must remember to re-implement the `getActiveVolunteer()` + role gate itself; forgetting it = an open door (service role bypasses RLS). Consider a shared route wrapper for ERP.

8. **🟡 `status` / `role` (messages) are unconstrained free text.** No CHECK/enum on `conversations.status` or `messages.role`; valid values live only in TS. ERP status machines should prefer explicit CHECK constraints or enums.

9. **🟢 Reusable building blocks.** First-login flow (§6), the nav rail (§5), the two-layer auth gate (§3), and the warm-palette component set are all cleanly reusable for ERP. The nav rail's `adminOnly` gate will need extending to module/role-aware gating.

---

### Introspection SQL to run when the DB is reachable (fills all UNKNOWNs)
```sql
select schemaname, tablename, rowsecurity from pg_tables where schemaname='public';
select * from pg_policies where schemaname='public' order by tablename, policyname;
select table_name, column_name, data_type, is_nullable, column_default
  from information_schema.columns where table_schema='public'
  order by table_name, ordinal_position;
select conname, conrelid::regclass, pg_get_constraintdef(oid)
  from pg_constraint where connamespace='public'::regnamespace;
select distinct role, count(*) from volunteers group by role;   -- actual role values in use
select id, name, public from storage.buckets;                   -- any storage buckets
```
