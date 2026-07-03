-- Phase 3 (user management): a volunteer's home 中心 (center).
--
-- Free-text label for which care center a volunteer belongs to (e.g. 吉隆坡).
-- Nullable — existing rows and volunteers without an assigned center stay NULL.
-- Editable by admins through the settings page (PATCH /api/dashboard/volunteers/[id]).
alter table volunteers add column center text;
