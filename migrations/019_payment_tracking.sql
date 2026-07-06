-- 019_payment_tracking.sql
-- =====================================================================================
-- PURPOSE (ERP task C3 — event payment tracking + optional receipt-proof upload).
--   The front edge of the Phase D finance wing. Payment lives ON the registration so D can
--   later aggregate 收款 per event / centre without a schema migration. Six columns track a
--   gentle, NON-COERCIVE payment lifecycle, plus a PRIVATE Storage bucket for receipt images.
--
--   GUIDING ETHOS (charity 只求维持不求盈利): payment is ENTIRELY OPTIONAL and NEVER gates
--   registration or approval — a volunteer may approve attendance with payment still 'unpaid'.
--   'waived' (已豁免) is a first-class, guilt-free state. No overdue/shaming concept exists in
--   the data model; there is deliberately NO due-date column.
--
--   payment_status lifecycle (app-enforced, all transitions reversible):
--     unpaid  ──(public uploads a receipt)──▶  proof_submitted
--     unpaid / proof_submitted ──(staff 核实)──▶  verified   (paid_amount + verified_by/at)
--     any ──(staff 标记豁免)──▶  waived   (paid_amount 0, verified_by/at record who waived)
--     verified / waived ──(staff 撤销)──▶  proof_submitted (if a proof exists) else unpaid
--
--   STORAGE — private bucket 'payment-proofs', public = FALSE.
--     Receipts carry bank / personal data — the bucket must NEVER be world-readable. There are
--     DELIBERATELY NO storage RLS policies for the anon or authenticated Postgres roles: every
--     object is written by the app's service-role client (the gated public upload route) and
--     read by staff ONLY through server-minted SHORT-LIVED signed URLs (events:view route).
--     The anon Postgres role is never used, exactly like the rest of the public surface (018).
--
--   Writes stay service-role-only; audit is app-level via writeAudit (public actor_email='public'
--   for the upload; the verifying volunteer for staff actions).
--
-- APPLY MANUALLY (Supabase SQL Editor). Run docs/erp/13-c3-verification.md PREFLIGHT first;
--   STOP on any deviation. Apply this BEFORE deploying the C3 code (routes read the new
--   columns and the 'payment-proofs' bucket).
--
-- ROLLBACK (manual):
--   -- empty the bucket first if it has objects, then:
--   delete from storage.buckets where id = 'payment-proofs';
--   alter table public.registrations
--     drop column if exists payment_verified_at,
--     drop column if exists payment_verified_by,
--     drop column if exists payment_note,
--     drop column if exists paid_amount,
--     drop column if exists payment_proof_path,
--     drop column if exists payment_status;
-- =====================================================================================


-- ── (a) registrations: the payment-tracking columns ──────────────────────────────────
alter table public.registrations
  add column payment_status text not null default 'unpaid'
    check (payment_status in ('unpaid', 'proof_submitted', 'verified', 'waived')),
  add column payment_proof_path text,                          -- private Storage object path (null = none)
  add column paid_amount numeric(10, 2),                       -- acknowledged amount (null until verified/waived)
  add column payment_note text,                                -- staff note: receipt no / 'HQ 豁免' / etc.
  add column payment_verified_by uuid references public.volunteers(id),
  add column payment_verified_at timestamptz;


-- ── (b) PRIVATE Storage bucket for receipt proofs (public = false) ───────────────────
-- No storage RLS policies: all access is via the app's service-role client (upload) + staff
-- short-lived signed URLs (read). The bucket must never be world-readable (receipts = PII).
insert into storage.buckets (id, name, public)
values ('payment-proofs', 'payment-proofs', false)
on conflict (id) do nothing;
