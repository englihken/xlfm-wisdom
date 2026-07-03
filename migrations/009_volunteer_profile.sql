-- Phase 3 (user management round 3): richer volunteer profile + forced first-login
-- password change.
--
-- must_change_password : set true when an admin creates the account (with an initial
--                        password). The dashboard shows a full-screen "set your new
--                        password" gate until the volunteer changes it, then it is
--                        cleared to false.
-- occupation           : free-text 职业, nullable.
-- skills               : free-text 专长/技能 (short), nullable.
alter table volunteers add column must_change_password boolean not null default false;
alter table volunteers add column occupation text;
alter table volunteers add column skills text;
