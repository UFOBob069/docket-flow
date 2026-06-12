-- DocketFlow reads Slack links from the existing firm table (singular name).
-- Migration 014 created an unused empty `cases_slack_channels` — ignore that table.

comment on table public.case_slack_channels is
  'Firm Slack channel per case_number; linked from DocketFlow case detail page.';

-- Ensure signed-in users can read (table may have RLS off already; this is idempotent).
alter table public.case_slack_channels enable row level security;

drop policy if exists "case_slack_channels_firm_select" on public.case_slack_channels;

create policy "case_slack_channels_firm_select"
  on public.case_slack_channels for select to authenticated using (true);
