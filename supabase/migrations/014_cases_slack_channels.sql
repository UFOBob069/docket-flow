-- Legacy / unused: firm data lives in `case_slack_channels` (singular). See 015.
create table if not exists public.cases_slack_channels (
  case_number text primary key,
  slack_channel_id text not null,
  slack_channel_name text
);

comment on table public.cases_slack_channels is
  'Maps firm case_number to Slack channel for links on the case detail page.';

alter table public.cases_slack_channels enable row level security;

drop policy if exists "cases_slack_channels_firm_select" on public.cases_slack_channels;

create policy "cases_slack_channels_firm_select"
  on public.cases_slack_channels for select to authenticated using (true);
