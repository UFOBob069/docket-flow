-- Google Calendar event color (`colorId` on insert/patch) — optional palette chip in the app.
alter table public.case_events
  add column if not exists google_color_id text;

comment on column public.case_events.google_color_id is
  'Optional Google Calendar API event colorId (e.g. "7" Peacock). Null = default calendar color.';
