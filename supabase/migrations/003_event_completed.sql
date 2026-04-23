-- Track user-marked completion so past events are not treated as overdue in the app UI.
alter table public.case_events
  add column if not exists completed boolean not null default false;
