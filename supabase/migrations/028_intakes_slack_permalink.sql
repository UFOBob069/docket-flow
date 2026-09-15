-- Quo router stores Slack thread permalinks on intakes (and per-event on intake_interactions).
alter table public.intakes
  add column if not exists slack_permalink text;

comment on column public.intakes.slack_permalink is
  'Slack permalink to the #lead-calls thread for this intake (written by Quo router).';
