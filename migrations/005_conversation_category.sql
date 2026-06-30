-- Phase 3: automatic conversation categorisation.
-- category   = the problem-type topic (one of a fixed Chinese label set), set by a
--              cheap post-reply classification call. NULL until first classified.
-- crisis_flag = separate overlay; can be true for ANY category when the
--              conversation shows crisis / self-harm / severe-distress signals.
alter table conversations add column category text;
alter table conversations add column crisis_flag boolean not null default false;
