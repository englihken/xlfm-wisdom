-- 050: synthetic contacts (chip warm-ups, test suites) are flagged so the care
-- dashboard, nightly summaries/profiles, reviews and counts can exclude them.
-- 2026-09-12: the chip warm-up script tags conversations browserId=chip-warm:<lang>,
-- so all six chip questions of a language fold into ONE anonymous contact whose
-- 有缘人档案 then reads like a person with every problem at once.
-- Applied by the architect via apply_migration on 2026-09-12 (project adxetazkbdoahfphnini).
alter table public.contacts
  add column if not exists is_test boolean not null default false;

comment on column public.contacts.is_test is
  'synthetic contact (chip warm-up / test suite): hidden from the care inbox, skipped by summaries, profiles, reviews and counts';

update public.contacts
   set is_test = true
 where browser_id like 'chip-warm:%' or browser_id like 'test:%' or browser_id like 'test-suite:%';

create index if not exists contacts_is_test_idx on public.contacts (is_test) where is_test;
