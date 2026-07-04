-- Human takeover: attribute volunteer-authored messages.
-- A shared conversation can be taken over by a volunteer (status =
-- 'volunteer_handling', conversations.assigned_volunteer set — both from Phase 2).
-- While handled, the volunteer's replies are stored as messages with
-- role='volunteer' and sent_by = the authoring volunteer, so every human action is
-- attributable and reviewable. Null for AI ('assistant') and visitor ('user') rows.
alter table messages add column sent_by uuid references volunteers(id);
