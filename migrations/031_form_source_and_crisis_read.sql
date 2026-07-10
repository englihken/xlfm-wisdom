-- 031_form_source_and_crisis_read
-- E2 follow-ups after the build report:
-- (1) allow source_type='form' on contacts — the inbox→渡人 bridge writes it (029/E2 §7.1);
--     030 missed extending this CHECK (constraint predates the inbox).
-- (2) DB-tier parity for the crisis wall-bypass (§1.4): the app lets 关怀组 (care≥edit)
--     OPEN active crisis threads across the centre wall so they can actually follow up;
--     mirror that branch in can_read_inbox_thread so RLS and app walls stay identical.

-- ============ 1. contacts.source_type += 'form' ============

alter table public.contacts drop constraint contacts_source_type_check;
alter table public.contacts add constraint contacts_source_type_check
  check (source_type = any (array['chat'::text,'event'::text,'referral'::text,'walkin'::text,'form'::text]));

-- ============ 2. crisis follow-up branch in the DB wall ============

create or replace function public.can_read_inbox_thread(p_thread_id uuid)
returns boolean
language sql
stable security definer
set search_path to 'public', 'pg_temp'
as $$
  select exists (
    select 1
    from public.inbox_threads t
    join public.inbox_mailboxes m on m.id = t.mailbox_id
    where t.id = p_thread_id
      and (
        -- (a) mailbox owner
        exists (select 1 from public.inbox_mailbox_owners o
                where o.mailbox_id = m.id and o.volunteer_id = auth.uid())
        -- (b) inbox edit within centre scope (centre_head own centre; admin all)
        or (public.has_module_access('inbox','edit') and public.centre_scope_allows(m.centre_id))
        -- (c) internal threads: sender side too
        or (t.kind = 'internal' and t.from_centre_id is not null and (
              (public.has_module_access('inbox','edit') and public.centre_scope_allows(t.from_centre_id))
              or exists (select 1 from public.inbox_mailbox_owners o2
                         join public.inbox_mailboxes m2 on m2.id = o2.mailbox_id
                         where m2.centre_id = t.from_centre_id and o2.volunteer_id = auth.uid())
        ))
        -- (d) crisis follow-up: national care team (care>=edit) may read ACTIVE crisis
        --     threads across the centre wall (§1.4 — escalation is open and immediate)
        or (t.crisis_flag and t.status <> 'archived' and public.has_module_access('care','edit'))
      )
  );
$$;
