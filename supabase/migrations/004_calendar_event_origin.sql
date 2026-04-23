-- Origin: DocketFlow-managed sync vs local mirror of Google Calendar (e.g. ICS import; no API link).
alter table public.case_events
  add column if not exists calendar_origin text not null default 'docketflow'
  check (calendar_origin in ('docketflow', 'google_ics_mirror'));
