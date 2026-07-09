# Housekeeping — purge prod test data (migration 021)

Covers `migrations/021_cleanup_test_data.sql`: a **one-off DATA cleanup** (no schema changes)
that removes the test fixtures created while building Phases B/C/D. It frees the **XLFM-2608**
event code for the real **Aug 2026 法会** (event codes are `UNIQUE` — a leftover test event would
block the real one) and clears test rows before real member/event data lands.

> **This is a data delete — there is no rollback.** The PREFLIGHT is mandatory: confirm every
> row/count is exactly the expected test data before applying. The APPLY block is a single
> **guarded** transaction that RAISES (aborting everything) if the target set is anything other
> than the 3 test events + 2 test members, or if a test member is entangled with real data.
> For a dry run, change the final `COMMIT` to `ROLLBACK`.

## What is purged, and why

**Why now:** the real August 2026 event is incoming and needs the `XLFM-2608` code. Test rows
must be gone before real registrations/members arrive so reports and feeds aren't polluted.

| Purged | How targeted | Children removed with it |
|---|---|---|
| Events `XLFM-2608` (测试法会), `XLFM-2608B` (小型共修), `XLFM-2608C` (素宴测试) | exact `code IN (…)` | `registrations` (incl. `payment_*` fields, `selections` meal picks, `fee_breakdown` snapshot — all row-local), `event_fees`, `event_team_needs`, `event_meal_slots`. `public_token` is an events column, freed with the row. |
| Members `测试会员`, `ERP权限测试` | exact `name_cn IN (…)` | `member_teams`, `member_skills` |

Targets are pinned by **exact code / name** in the DELETEs — never a broad `LIKE`. (`LIKE
'XLFM-2608%'` appears only in read-only PREFLIGHT/VERIFY, to surface stray codes and prove the
family is gone.)

## Explicitly NOT touched

- **volunteers / accounts** — `ken@edugps` and `ken@tiseno` stay. No volunteer row is read or written.
- **centres, teams** — reference data, untouched.
- **audit_log** — append-only. The test entities' audit rows **remain by design**; they simply age
  out of the dashboard feeds. We never delete audit history.
- **care wing** — `contacts` / `conversations` / `messages` untouched (VERIFY proves the
  conversations count is unchanged).

## Storage — a MANUAL follow-up (SQL can't do it)

The `payment-proofs` bucket objects attached to the deleted test registrations are **not** removed
by this migration. PREFLIGHT **(P4)** lists their `payment_proof_path`s and **(P4b)** lists the
bucket's objects; after applying, delete those specific files in the Supabase dashboard. Leave any
object **not** in the P4 list alone.

---

## PREFLIGHT (read-only) — STOP on any deviation

Run all of P1–P8 in the SQL Editor and confirm the results **are** the test data:

- **P1** — the `XLFM-2608*` event family. Expect **exactly three** codes (`XLFM-2608`,
  `XLFM-2608B`, `XLFM-2608C`). A 4th code ⇒ reconcile before editing the delete list.
- **P2** — per-event child counts (registrations / event_fees / team_needs / meal_slots).
- **P3** — the registrations to be removed, including their `payment_status` / `paid_amount` /
  `payment_proof_path` (shows exactly what the payment cleanup covers).
- **P4 / P4b** — the payment-proof storage paths (the manual delete list) + a bucket cross-check.
- **P5** — the two test members' **full rows** — visually confirm phone/centre/created_at identify
  them as fixtures, not a real member sharing the name. Expect **exactly two** rows.
- **P6** — their `member_teams` / `member_skills` counts.
- **P7** — **referential safety: each must return 0 rows** — (a) no test-member registration on a
  non-target event, (b) no non-test member names a test member as referrer, (c) no `legacy_rows`
  point at a test member. A row here means real data is entangled → STOP.
- **P8** — record `volunteers_before`, `conversations_before`, `members_before` for the VERIFY
  comparison.

## APPLY

Run the guarded `begin; … commit;` block. Order: the DO-block guards (abort on any surprise) →
event children (`registrations`, `event_meal_slots`, `event_team_needs`, `event_fees`) → `events`
→ member children (`member_teams`, `member_skills`) → `members` → the in-transaction freed-code
check (must return 0 rows) → `commit`. Registrations are deleted before events because
`registrations.event_id` is a plain FK (no cascade).

## VERIFY (after commit)

| # | Query | Expect |
|---|---|---|
| V1 | `events` where code `LIKE 'XLFM-2608%'` | **0** — code freed for the real event |
| V2 | `registrations` where `reg_no LIKE 'XLFM-2608%'` | **0** |
| V3 | `members` where `name_cn IN ('测试会员','ERP权限测试')` | **0** |
| V4 | volunteers / conversations / members counts | volunteers = `volunteers_before`; conversations = `conversations_before`; members = `members_before − 2` |
| V5 | `audit_log` count | unchanged (history intact) |

## Follow-up checklist

- [ ] PREFLIGHT P1–P8 reviewed; all P7 checks returned 0 rows.
- [ ] APPLY committed; freed-code check returned 0 rows.
- [ ] VERIFY V1–V5 pass.
- [ ] **Manual:** deleted the P4 payment-proof files in the `payment-proofs` bucket.
- [ ] `XLFM-2608` now free for the real Aug 2026 event.
