-- Run in Supabase SQL editor or: supabase db push
-- Before auth: Dashboard → Authentication → Providers → Email (password).
-- URL config: Redirect URLs include /auth/callback and /auth/update-password (local + prod).
-- DocketFlow: cases, events, contacts, activity

create extension if not exists "pgcrypto";

-- Contacts
create table public.contacts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  email text not null,
  role text not null check (role in ('attorney', 'paralegal', 'legal_assistant', 'other')),
  created_at bigint not null,
  updated_at bigint not null
);

create index contacts_user_name on public.contacts (user_id, name);

-- Cases
create table public.cases (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  client_name text not null,
  case_number text,
  cause_number text,
  court text,
  date_of_incident text,
  notes text,
  case_type text,
  status text not null default 'active' check (status in ('active', 'archived')),
  document_url text,
  document_file_name text,
  assigned_contact_ids uuid[] not null default '{}',
  created_at bigint not null,
  updated_at bigint not null
);

create index cases_user_updated on public.cases (user_id, updated_at desc);

-- Calendar events (formerly Firestore subcollection)
create table public.case_events (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.cases (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null,
  date text not null,
  description text not null default '',
  category text not null,
  event_kind text,
  start_date_time text,
  end_date_time text,
  deponent_or_subject text,
  external_attendees_text text,
  extra_internal_contact_ids uuid[],
  zoom_link text,
  priority text,
  google_event_id text,
  google_calendar_event_ids_by_email jsonb,
  included boolean not null default true,
  group_suggested boolean not null default false,
  group_id text,
  merge_with_same_group boolean default false,
  noise_flag boolean not null default false,
  noise_reason text,
  reminders_minutes int[] not null default '{}',
  email_reminders_sent int[],
  created_at bigint not null,
  updated_at bigint not null
);

create index case_events_case_date on public.case_events (case_id, date asc);

-- Activity log
create table public.activity_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  case_id uuid references public.cases (id) on delete set null,
  case_name text,
  action text not null,
  description text not null,
  user_email text not null,
  created_at bigint not null
);

create index activity_log_user_created on public.activity_log (user_id, created_at desc);

-- RLS
alter table public.contacts enable row level security;
alter table public.cases enable row level security;
alter table public.case_events enable row level security;
alter table public.activity_log enable row level security;

create policy "contacts_is_owner"
  on public.contacts for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "cases_is_owner"
  on public.cases for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "case_events_select"
  on public.case_events for select
  using (
    exists (select 1 from public.cases c where c.id = case_id and c.user_id = auth.uid())
  );

create policy "case_events_insert"
  on public.case_events for insert
  with check (
    auth.uid() = user_id
    and exists (select 1 from public.cases c where c.id = case_id and c.user_id = auth.uid())
  );

create policy "case_events_update"
  on public.case_events for update
  using (
    exists (select 1 from public.cases c where c.id = case_id and c.user_id = auth.uid())
  )
  with check (
    auth.uid() = user_id
    and exists (select 1 from public.cases c where c.id = case_id and c.user_id = auth.uid())
  );

create policy "case_events_delete"
  on public.case_events for delete
  using (
    exists (select 1 from public.cases c where c.id = case_id and c.user_id = auth.uid())
  );

create policy "activity_is_owner"
  on public.activity_log for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Realtime
alter publication supabase_realtime add table public.cases;
alter publication supabase_realtime add table public.case_events;
alter publication supabase_realtime add table public.contacts;
alter publication supabase_realtime add table public.activity_log;
