-- DocketFlow new-case flow writes injuries + case_description to case_tracker_entries.
-- Case Tracker keeps role-gated full edit; any authenticated firm user may insert or patch intake fields.

drop policy if exists "tracker entries insert by authenticated" on public.case_tracker_entries;
create policy "tracker entries insert by authenticated"
  on public.case_tracker_entries
  for insert
  to authenticated
  with check (true);

drop policy if exists "tracker entries update by authenticated" on public.case_tracker_entries;
create policy "tracker entries update by authenticated"
  on public.case_tracker_entries
  for update
  to authenticated
  using (true)
  with check (true);
