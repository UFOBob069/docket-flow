-- Audit: who created the event (firm Google email), for timeline display.
alter table public.case_events
  add column if not exists created_by_email text;

comment on column public.case_events.created_by_email is
  'Google workspace email of the user who created the row (set on insert from the app).';
