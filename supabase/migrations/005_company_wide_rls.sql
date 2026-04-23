-- Firm-wide data: any authenticated user in this project sees/edits the same cases, events, contacts, and activity.
-- (Access is still limited to signed-in users; the app enforces @ramosjames.com on the client.)

drop policy if exists "contacts_is_owner" on public.contacts;
drop policy if exists "cases_is_owner" on public.cases;
drop policy if exists "case_events_select" on public.case_events;
drop policy if exists "case_events_insert" on public.case_events;
drop policy if exists "case_events_update" on public.case_events;
drop policy if exists "case_events_delete" on public.case_events;
drop policy if exists "activity_is_owner" on public.activity_log;

-- Contacts
create policy "contacts_firm_select"
  on public.contacts for select to authenticated using (true);

create policy "contacts_firm_insert"
  on public.contacts for insert to authenticated with check (true);

create policy "contacts_firm_update"
  on public.contacts for update to authenticated using (true) with check (true);

create policy "contacts_firm_delete"
  on public.contacts for delete to authenticated using (true);

-- Cases
create policy "cases_firm_select"
  on public.cases for select to authenticated using (true);

create policy "cases_firm_insert"
  on public.cases for insert to authenticated with check (true);

create policy "cases_firm_update"
  on public.cases for update to authenticated using (true) with check (true);

create policy "cases_firm_delete"
  on public.cases for delete to authenticated using (true);

-- Case events (user_id column remains for audit; RLS no longer scopes by it)
create policy "case_events_firm_select"
  on public.case_events for select to authenticated using (true);

create policy "case_events_firm_insert"
  on public.case_events for insert to authenticated with check (true);

create policy "case_events_firm_update"
  on public.case_events for update to authenticated using (true) with check (true);

create policy "case_events_firm_delete"
  on public.case_events for delete to authenticated using (true);

-- Activity log (shared dashboard feed)
create policy "activity_firm_select"
  on public.activity_log for select to authenticated using (true);

create policy "activity_firm_insert"
  on public.activity_log for insert to authenticated with check (true);

create policy "activity_firm_update"
  on public.activity_log for update to authenticated using (true) with check (true);

create policy "activity_firm_delete"
  on public.activity_log for delete to authenticated using (true);
