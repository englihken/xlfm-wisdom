-- 026_finance_receipts_bucket — private bucket for expense receipt photos (D4 单据照片),
-- same pattern as payment-proofs / inventory-media: service-role mediated, signed URLs.
-- [APPLIED VIA CONNECTOR 2026-07-10 — canonical record only, never run]
insert into storage.buckets (id, name, public)
values ('finance-receipts', 'finance-receipts', false)
on conflict (id) do nothing;
