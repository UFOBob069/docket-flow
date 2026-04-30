-- Per-contact rule for who receives Google calendar copies of firm-synced events.
alter table public.contacts
  add column if not exists team_calendar_scope text not null default 'assigned_cases'
  check (team_calendar_scope in ('assigned_cases', 'all_firm_events'));

comment on column public.contacts.team_calendar_scope is
  'assigned_cases: calendar copy only when contact is on the case; all_firm_events: always include on team calendar sync (deduped by email with assignees).';
