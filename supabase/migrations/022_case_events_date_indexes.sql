-- Speed firm-wide and date-range scans on case_events (PostgREST timeouts under load).
create index if not exists case_events_date_idx on public.case_events (date);
create index if not exists case_events_deadline_end_date_idx
  on public.case_events (deadline_end_date)
  where deadline_end_date is not null;
create index if not exists case_events_completed_included_date_idx
  on public.case_events (completed, included, date);
