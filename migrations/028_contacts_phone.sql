-- =====================================================================================
-- 028_contacts_phone.sql — phone on contacts (Phase E1 workbench)  [APPLIED VIA CONNECTOR]
-- =====================================================================================
-- The 渡人 work queue is a follow-up list: volunteers call/WhatsApp people. Chat-born
-- contacts may have wa_id, but event-bridged and manually-added 善缘 need a plain phone
-- field (prefilled from registrations.applicant_phone by the events bridge).

alter table public.contacts add column if not exists phone text;

-- ---------- VERIFY ----------
-- select column_name from information_schema.columns
--   where table_name='contacts' and column_name='phone'; -- 1 row
