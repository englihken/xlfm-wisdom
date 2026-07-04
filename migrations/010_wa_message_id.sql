-- Phase 5 Track B: WhatsApp inbound de-duplication.
-- Meta retries webhook deliveries (at-least-once), so the same inbound message
-- can arrive several times. We stamp each persisted inbound user message with the
-- provider's message id and refuse to reprocess one we've already stored.
alter table messages add column wa_message_id text;

-- Unique only where present: web messages leave it null (and null is exempt from
-- the uniqueness constraint in Postgres), so many nulls coexist while WhatsApp ids
-- stay one-to-one.
create unique index idx_messages_wa_message_id
  on messages(wa_message_id)
  where wa_message_id is not null;
