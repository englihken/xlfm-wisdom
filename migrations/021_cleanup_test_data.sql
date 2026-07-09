-- 021_cleanup_test_data.sql
-- =====================================================================================
-- PURPOSE (housekeeping — one-off DATA cleanup, NO schema changes).
--   Purges the prod test fixtures created while building Phases B/C/D so the real
--   Aug 2026 法会 can land on clean data — and, critically, so the event code
--   XLFM-2608 is FREED for that real event (codes are UNIQUE; a leftover test event
--   would block it).
--
--   TARGETS (and nothing else):
--     • Test EVENTS by exact code — XLFM-2608 (测试法会), XLFM-2608B (小型共修),
--       XLFM-2608C (素宴测试) — plus ALL their children:
--         registrations (incl. the payment_* columns, meal selections in
--         selections jsonb, and the fee_breakdown snapshot — all row-local),
--         event_fees, event_team_needs, event_meal_slots.
--       (public_token is an events column — it is freed with the event row. Fee
--        "snapshots" are registrations.fee_breakdown jsonb — removed with the reg.)
--     • Test MEMBERS by exact name — 测试会员, ERP权限测试 — plus their member_teams
--       and member_skills rows.
--
--   DELIBERATELY NOT TOUCHED:
--     • volunteers / accounts (ken@edugps, ken@tiseno stay) — no volunteer row is
--       read or written here.
--     • centres, teams (reference data).
--     • audit_log — APPEND-ONLY. The test entities' audit rows STAY; they simply age
--       out of the dashboard feeds. We never delete audit history.
--     • Any care-wing table (contacts / conversations / messages) — untouched.
--
--   STORAGE (SQL can't do this): the payment-proofs bucket objects for the deleted
--   test registrations are NOT removed by this migration. PREFLIGHT lists their paths;
--   remove those files MANUALLY in the Supabase dashboard afterwards.
--
-- APPLY MANUALLY (Supabase SQL Editor). Run docs/erp/15-cleanup.md PREFLIGHT first and
--   CONFIRM every count/row is exactly the expected test data; STOP on any deviation.
--   The APPLY block is a single guarded transaction — the guards RAISE (aborting the
--   whole transaction) if the target set is anything other than the 3 events + 2 members,
--   or if a test member is referenced from outside the target events.
--
-- REVERSIBILITY: none — this DELETES data. There is no rollback. That is why PREFLIGHT
--   verification is mandatory and the APPLY guards are strict. (For a dry run, change the
--   final COMMIT to ROLLBACK: the guards + deletes execute and report, then unwind.)
-- =====================================================================================


-- ═════════════════════════════════════════════════════════════════════════════════════
-- PREFLIGHT — read-only. Run every query; confirm the results ARE the test data. STOP if
-- any count is higher than expected, an unexpected code/name appears, or a referential
-- safety check returns a row.
-- ═════════════════════════════════════════════════════════════════════════════════════

-- (P1) The test EVENT family. LIKE here (read-only) reveals ALL 'XLFM-2608*' codes so a
--      stray 4th code surfaces. Expect EXACTLY three: XLFM-2608, XLFM-2608B, XLFM-2608C.
select id, code, title, event_type, status, starts_on, public_token is not null as has_token
  from public.events
 where code like 'XLFM-2608%'
 order by code;

-- (P2) Child-row counts per target event (via joins). Everything here will be deleted.
select e.code,
       (select count(*) from public.registrations    r  where r.event_id  = e.id) as registrations,
       (select count(*) from public.event_fees       ef where ef.event_id = e.id) as event_fees,
       (select count(*) from public.event_team_needs tn where tn.event_id = e.id) as team_needs,
       (select count(*) from public.event_meal_slots ms where ms.event_id = e.id) as meal_slots
  from public.events e
 where e.code in ('XLFM-2608', 'XLFM-2608B', 'XLFM-2608C')
 order by e.code;

-- (P3) The registrations to be removed, incl. their payment_* fields (proof of what the
--      payment cleanup covers).
select e.code, r.reg_no, r.status, r.member_id, r.applicant_name,
       r.payment_status, r.paid_amount, r.payment_proof_path
  from public.registrations r
  join public.events e on e.id = r.event_id
 where e.code in ('XLFM-2608', 'XLFM-2608B', 'XLFM-2608C')
 order by e.code, r.reg_no;

-- (P4) PAYMENT-PROOF STORAGE PATHS — the MANUAL delete list. SQL cannot remove Storage
--      objects; after applying, delete these files in the dashboard (bucket payment-proofs).
select e.code, r.reg_no, r.payment_proof_path
  from public.registrations r
  join public.events e on e.id = r.event_id
 where e.code in ('XLFM-2608', 'XLFM-2608B', 'XLFM-2608C')
   and r.payment_proof_path is not null
 order by e.code, r.reg_no;

-- (P4b) Cross-check: all objects currently in the payment-proofs bucket (match the paths
--       from P4 against these before deleting; leave any object NOT in P4 alone).
select id, name, created_at
  from storage.objects
 where bucket_id = 'payment-proofs'
 order by created_at;

-- (P5) The test MEMBERS — full rows, so you can VISUALLY CONFIRM these are the fixtures
--      (phone, centre, created_at) and not a real member who happens to share the name.
--      Expect EXACTLY two rows: 测试会员 and ERP权限测试.
select id, name_cn, name_en, phone, gyt_centre_id, member_type, status, created_at, created_by
  from public.members
 where name_cn in ('测试会员', 'ERP权限测试')
 order by name_cn;

-- (P6) Their child-row counts (member_teams / member_skills) — all to be deleted.
select m.name_cn,
       (select count(*) from public.member_teams  mt where mt.member_id = m.id) as member_teams,
       (select count(*) from public.member_skills ms where ms.member_id = m.id) as member_skills
  from public.members m
 where m.name_cn in ('测试会员', 'ERP权限测试')
 order by m.name_cn;

-- (P7) REFERENTIAL SAFETY — every query below MUST return 0 rows. A row means the test
--      member is entangled with real data; STOP and reconcile before applying.
--   (a) a test member registered on a NON-target event:
select e.code, r.reg_no, m.name_cn
  from public.registrations r
  join public.members m on m.id = r.member_id
  join public.events  e on e.id = r.event_id
 where m.name_cn in ('测试会员', 'ERP权限测试')
   and e.code not in ('XLFM-2608', 'XLFM-2608B', 'XLFM-2608C');
--   (b) a NON-test member naming a test member as referrer:
select id, name_cn
  from public.members
 where referrer_member_id in (select id from public.members where name_cn in ('测试会员', 'ERP权限测试'))
   and name_cn not in ('测试会员', 'ERP权限测试');
--   (c) a legacy import row still pointing at a test member:
select lr.id, lr.member_id
  from public.legacy_rows lr
 where lr.member_id in (select id from public.members where name_cn in ('测试会员', 'ERP权限测试'));

-- (P8) BASELINES for the untouched-data check — RECORD these two numbers; VERIFY re-runs
--      them and they MUST be identical after APPLY.
select count(*) as volunteers_before    from public.volunteers;
select count(*) as conversations_before from public.conversations;
select count(*) as members_before       from public.members;   -- VERIFY expects this minus 2


-- ═════════════════════════════════════════════════════════════════════════════════════
-- APPLY — single guarded transaction. FK-safe order: children first, parents last.
-- Targets are pinned by the EXACT codes / names verified in PREFLIGHT — never a LIKE.
-- ═════════════════════════════════════════════════════════════════════════════════════
begin;

-- ── Guards: abort the whole transaction unless the target set is exactly as expected ──
do $$
declare
  n_events  int;
  n_members int;
  n_stray   int;
begin
  select count(*) into n_events
    from public.events
   where code in ('XLFM-2608', 'XLFM-2608B', 'XLFM-2608C');
  if n_events <> 3 then
    raise exception 'GUARD: expected 3 test events, found % — STOP and reconcile', n_events;
  end if;

  select count(*) into n_members
    from public.members
   where name_cn in ('测试会员', 'ERP权限测试');
  if n_members <> 2 then
    raise exception 'GUARD: expected 2 test members, found % — STOP (name collision or missing fixture)', n_members;
  end if;

  select count(*) into n_stray
    from public.registrations r
    join public.members m on m.id = r.member_id
   where m.name_cn in ('测试会员', 'ERP权限测试')
     and r.event_id not in (select id from public.events
                             where code in ('XLFM-2608', 'XLFM-2608B', 'XLFM-2608C'));
  if n_stray > 0 then
    raise exception 'GUARD: test member(s) have % registration(s) OUTSIDE the target events — STOP', n_stray;
  end if;

  select count(*) into n_stray
    from public.members
   where referrer_member_id in (select id from public.members where name_cn in ('测试会员', 'ERP权限测试'))
     and name_cn not in ('测试会员', 'ERP权限测试');
  if n_stray > 0 then
    raise exception 'GUARD: a non-test member references a test member as referrer — STOP';
  end if;

  select count(*) into n_stray
    from public.legacy_rows lr
   where lr.member_id in (select id from public.members where name_cn in ('测试会员', 'ERP权限测试'));
  if n_stray > 0 then
    raise exception 'GUARD: legacy_rows reference a test member — STOP';
  end if;
end $$;

-- ── Event children first (registrations has a plain FK to events — no cascade) ────────
delete from public.registrations
 where event_id in (select id from public.events
                     where code in ('XLFM-2608', 'XLFM-2608B', 'XLFM-2608C'));

delete from public.event_meal_slots
 where event_id in (select id from public.events
                     where code in ('XLFM-2608', 'XLFM-2608B', 'XLFM-2608C'));

delete from public.event_team_needs
 where event_id in (select id from public.events
                     where code in ('XLFM-2608', 'XLFM-2608B', 'XLFM-2608C'));

delete from public.event_fees
 where event_id in (select id from public.events
                     where code in ('XLFM-2608', 'XLFM-2608B', 'XLFM-2608C'));

-- ── The events themselves — frees the XLFM-2608 code family ────────────────────────────
delete from public.events
 where code in ('XLFM-2608', 'XLFM-2608B', 'XLFM-2608C');

-- ── Member children, then the members ─────────────────────────────────────────────────
delete from public.member_teams
 where member_id in (select id from public.members where name_cn in ('测试会员', 'ERP权限测试'));

delete from public.member_skills
 where member_id in (select id from public.members where name_cn in ('测试会员', 'ERP权限测试'));

delete from public.members
 where name_cn in ('测试会员', 'ERP权限测试');

-- ── Freed-code check (inside the txn) — MUST return 0 rows. If it does not, ROLLBACK. ──
select code, title from public.events where code like 'XLFM-2608%';

commit;   -- ← swap to ROLLBACK for a dry run (guards + deletes run and report, then unwind)


-- ═════════════════════════════════════════════════════════════════════════════════════
-- VERIFY — after COMMIT. Targets at zero; real data provably untouched.
-- ═════════════════════════════════════════════════════════════════════════════════════

-- (V1) The XLFM-2608 code family is gone (code freed for the real Aug 2026 event).
select count(*) as events_left from public.events where code like 'XLFM-2608%';           -- expect 0

-- (V2) No registration from the test family survives (reg_no carries the event code).
select count(*) as regs_left from public.registrations where reg_no like 'XLFM-2608%';    -- expect 0

-- (V3) The test members are gone (and thus their member_teams/member_skills via the deletes).
select count(*) as test_members_left from public.members where name_cn in ('测试会员', 'ERP权限测试');  -- expect 0

-- (V4) SANITY — real data untouched. Compare against the P8 baselines.
select count(*) as volunteers_now    from public.volunteers;      -- MUST equal volunteers_before
select count(*) as conversations_now from public.conversations;   -- MUST equal conversations_before (care wing untouched)
select count(*) as members_now       from public.members;         -- MUST equal members_before − 2

-- (V5) Audit history was NOT touched — test-entity audit rows remain by design.
select count(*) as audit_rows_intact from public.audit_log;       -- unchanged from before APPLY
