-- 038_normalize_registration_phones.sql
-- =====================================================================================
-- PURPOSE (DATA FIX — event-813 import follow-up).
--   registrations.applicant_phone was bulk-imported in the source sheets' raw formats.
--   Actual distribution on event XLFM-2608 (893 rows with a phone, verified 2026-07-16):
--     488  MY local with leading 0        (0122037919)
--     255  MY international               (60122037919)
--      16  SG international               (6581221124)
--     134  "odd": Indonesian intl 62…, Indonesian/MY mobiles with the leading 0 eaten
--          by Excel (81364280020 → 081364…, 129873326 → 0129873…), one bare SG mobile,
--          quote/equals-mangled MY numbers (‘0128116400, 012=2355771), and two 'a/b'
--          dual-number cells.
--   The app's canonical form (normalizePhone, src/lib/members.ts) is international
--   digits without '+': MY 60\d{8,10} · SG 65[3689]\d{7} · ID 62\d{8,12}.
--   Unnormalized storage breaks every exact-match surface: the public status lookup
--   (/api/public/lookup), payment-proof upload, and the register route's duplicate
--   guard. The app now ALSO canonicalizes the stored side at read time (see
--   canonicalizeStoredPhone), so this migration is about durable consistency and
--   restoring the 018 dupe index's cross-format backstop — not an emergency.
--
--   COUNTRY-AWARE: never blindly prepend 60. The rules below classify by shape:
--     ^1\d{8,9}$    MY mobile missing its leading 0        → 60 || d
--     ^8\d{9,11}$   Indonesian mobile missing its leading 0 → 62 || d
--     ^[89]\d{7}$   bare SG mobile (8 digits)               → 65 || d
--     ^08\d{9,11}$  Indonesian local                        → 62 || substr(d,2)
--     ^0\d{8,10}$   MY local                                → 6  || d
--     ^(60|65|62)…  already canonical                       → kept
--     anything else                                         → LEFT UNTOUCHED (reported)
--   Junk characters are stripped and only the FIRST number of an 'a/b' cell is kept —
--   the full raw value is preserved forever in selections.import813.phone.
--
--   COLLISIONS: normalization can make two member_id-NULL pending/approved rows of the
--   same event carry the same phone, violating the 018 registrations_public_dupe
--   partial unique index (confirmed real: XLFM-2608-0862 '85264068528' and -0886
--   '6285264068528' are the same number). Resolution matches the import's shared-phone
--   policy: the LOWEST reg_no keeps applicant_phone; later rows get NULL (their number
--   stays in import813).
--
-- APPLY MANUALLY (Supabase SQL Editor). Run PART 1 first and review the counts;
--   PART 2 is the transactional fix; PART 3 verifies. STOP on any surprising number.
--
-- ROLLBACK: restore applicant_phone from selections.import813 (raw import values):
--   update public.registrations
--      set applicant_phone = nullif(regexp_replace(selections->'import813'->>'phone', '[\s-]', '', 'g'), '')
--    where selections ? 'import813';
--   (Rows not from the import must be handled from the audit log — none exist today.)
-- =====================================================================================


-- ── PART 1 — review counts (read-only; run first) ─────────────────────────────────────
with cleaned as (
  select id, event_id, reg_no, status, member_id, applicant_phone as old_phone,
         regexp_replace(split_part(applicant_phone, '/', 1), '\D', '', 'g') as d
    from public.registrations
   where applicant_phone is not null
), canon as (
  select *,
    case
      when d ~ '^1\d{8,9}$'   then '60' || d
      when d ~ '^8\d{9,11}$'  then '62' || d
      when d ~ '^[89]\d{7}$'  then '65' || d
      when d ~ '^08\d{9,11}$' then '62' || substr(d, 2)
      when d ~ '^0\d{8,10}$'  then '6'  || d
      else d
    end as c
  from cleaned
)
select
  count(*)                                                              as total_with_phone,
  count(*) filter (where c = old_phone)                                 as already_canonical,
  count(*) filter (where c ~ '^(60\d{8,10}|65[3689]\d{7}|62\d{8,12})$'
                     and c <> old_phone)                                as will_normalize,
  count(*) filter (where c !~ '^(60\d{8,10}|65[3689]\d{7}|62\d{8,12})$') as left_untouched,
  count(*) filter (where d ~ '^0\d{8,10}$'  and c <> old_phone)         as rule_my_local,
  count(*) filter (where d ~ '^1\d{8,9}$')                              as rule_my_missing0,
  count(*) filter (where d ~ '^8\d{9,11}$')                             as rule_id_missing0,
  count(*) filter (where d ~ '^08\d{9,11}$')                            as rule_id_local,
  count(*) filter (where d ~ '^[89]\d{7}$')                             as rule_sg_bare,
  count(*) filter (where old_phone like '%/%')                          as dual_cells
from canon;

-- collisions the fix must resolve (expect a handful; lowest reg_no wins):
with cleaned as (
  select id, event_id, reg_no, status, member_id,
         regexp_replace(split_part(applicant_phone, '/', 1), '\D', '', 'g') as d
    from public.registrations
   where applicant_phone is not null and member_id is null and status in ('pending','approved')
), canon as (
  select *,
    case
      when d ~ '^1\d{8,9}$'   then '60' || d
      when d ~ '^8\d{9,11}$'  then '62' || d
      when d ~ '^[89]\d{7}$'  then '65' || d
      when d ~ '^08\d{9,11}$' then '62' || substr(d, 2)
      when d ~ '^0\d{8,10}$'  then '6'  || d
      else d
    end as c
  from cleaned
)
select event_id, c as canonical_phone, array_agg(reg_no order by reg_no) as reg_nos
  from canon
 where c ~ '^(60\d{8,10}|65[3689]\d{7}|62\d{8,12})$'
 group by event_id, c
having count(*) > 1;

-- values that will be LEFT UNTOUCHED (manual review list):
select reg_no, applicant_phone
  from public.registrations
 where applicant_phone is not null
   and case
         when regexp_replace(split_part(applicant_phone, '/', 1), '\D', '', 'g') ~ '^1\d{8,9}$'   then '60' || regexp_replace(split_part(applicant_phone, '/', 1), '\D', '', 'g')
         when regexp_replace(split_part(applicant_phone, '/', 1), '\D', '', 'g') ~ '^8\d{9,11}$'  then '62' || regexp_replace(split_part(applicant_phone, '/', 1), '\D', '', 'g')
         when regexp_replace(split_part(applicant_phone, '/', 1), '\D', '', 'g') ~ '^[89]\d{7}$'  then '65' || regexp_replace(split_part(applicant_phone, '/', 1), '\D', '', 'g')
         when regexp_replace(split_part(applicant_phone, '/', 1), '\D', '', 'g') ~ '^08\d{9,11}$' then '62' || substr(regexp_replace(split_part(applicant_phone, '/', 1), '\D', '', 'g'), 2)
         when regexp_replace(split_part(applicant_phone, '/', 1), '\D', '', 'g') ~ '^0\d{8,10}$'  then '6'  || regexp_replace(split_part(applicant_phone, '/', 1), '\D', '', 'g')
         else regexp_replace(split_part(applicant_phone, '/', 1), '\D', '', 'g')
       end !~ '^(60\d{8,10}|65[3689]\d{7}|62\d{8,12})$'
 order by reg_no;


-- ── PART 2 — the fix (single transaction; run ONLY after reviewing PART 1) ────────────
begin;

with cleaned as (
  select id, event_id, reg_no, status, member_id, applicant_phone as old_phone,
         regexp_replace(split_part(applicant_phone, '/', 1), '\D', '', 'g') as d
    from public.registrations
   where applicant_phone is not null
), canon as (
  select *,
    case
      when d ~ '^1\d{8,9}$'   then '60' || d
      when d ~ '^8\d{9,11}$'  then '62' || d
      when d ~ '^[89]\d{7}$'  then '65' || d
      when d ~ '^08\d{9,11}$' then '62' || substr(d, 2)
      when d ~ '^0\d{8,10}$'  then '6'  || d
      else d
    end as c
  from cleaned
), valid as (
  select *,
         -- rows competing for the 018 partial-unique slot rank by reg_no; rank 1 keeps
         -- the phone, later ranks get NULL (number preserved in import813). The window
         -- partitions on the qualifying predicate itself so non-qualifying rows
         -- (member-linked / rejected / cancelled) can never shift a qualifier's rank —
         -- they always keep their canonical value (rk forced to 1).
         case when member_id is null and status in ('pending','approved')
              then row_number() over (
                     partition by event_id, c, (member_id is null and status in ('pending','approved'))
                     order by reg_no)
              else 1 end as rk
    from canon
   where c ~ '^(60\d{8,10}|65[3689]\d{7}|62\d{8,12})$'
)
update public.registrations r
   set applicant_phone = case when v.rk = 1 then v.c else null end
  from valid v
 where r.id = v.id
   and (v.c <> v.old_phone or v.rk > 1);

commit;


-- ── PART 3 — verify ───────────────────────────────────────────────────────────────────
-- every remaining phone is canonical or on the reviewed leave-untouched list:
select count(*) as non_canonical_remaining
  from public.registrations
 where applicant_phone is not null
   and applicant_phone !~ '^(60\d{8,10}|65[3689]\d{7}|62\d{8,12})$';
-- the two confirmed test cases:
select reg_no, applicant_phone from public.registrations
 where reg_no in ('XLFM-2608-0001', 'XLFM-2608-0358');
-- 018 dupe-index integrity (must return 0 rows):
select event_id, applicant_phone, count(*)
  from public.registrations
 where applicant_phone is not null and member_id is null and status in ('pending','approved')
 group by event_id, applicant_phone having count(*) > 1;
