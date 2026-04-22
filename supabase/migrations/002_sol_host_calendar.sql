-- SOL milestones are stored on a shared Google Calendar (not each user's primary).
alter table public.case_events
  add column if not exists google_host_calendar_id text;
