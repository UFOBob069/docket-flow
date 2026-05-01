-- Deadline vs internal meeting (time-based); drives defaults and UI tone.
alter table public.case_events
  add column if not exists schedule_kind text not null default 'deadline'
  check (schedule_kind in ('deadline', 'meeting'));

comment on column public.case_events.schedule_kind is
  'deadline: typically all-day court/docket dates; meeting: internal time-block event.';
