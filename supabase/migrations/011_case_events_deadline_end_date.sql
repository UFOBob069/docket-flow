-- Optional inclusive end date for multi-day all-day deadlines (start remains `date`).
alter table public.case_events
  add column if not exists deadline_end_date date null;

comment on column public.case_events.deadline_end_date is
  'Last calendar day (inclusive) for a multi-day all-day deadline; null = single day (`date` only).';
