-- Phase 3: volunteer read access to care data.
--
-- RLS is already enabled on all three tables (see 003_enable_rls.sql), which
-- currently blocks everyone except the service_role key. These policies grant
-- READ (select) access to the 'authenticated' role only — i.e. logged-in
-- volunteers. The public 'anon' role gets no policy and therefore no access.
-- The service-role key continues to bypass RLS entirely (storage keeps working).

-- Authenticated volunteers can read all care data; public (anon) still blocked.
create policy "volunteers can read contacts" on contacts
  for select to authenticated using (true);
create policy "volunteers can read conversations" on conversations
  for select to authenticated using (true);
create policy "volunteers can read messages" on messages
  for select to authenticated using (true);
