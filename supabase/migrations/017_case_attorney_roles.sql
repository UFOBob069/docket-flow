-- Case owner vs DocketFlow event calendar attorney (Case Tracker sync-safe).
-- Tracker sync uses first role='attorney' in assigned_contact_ids — keep only the responsible attorney there.
alter table public.cases
  add column if not exists responsible_attorney_contact_id uuid references public.contacts (id) on delete set null;

alter table public.cases
  add column if not exists event_attorney_contact_id uuid references public.contacts (id) on delete set null;

comment on column public.cases.responsible_attorney_contact_id is
  'Primary case attorney (Case Tracker owner). Must be the only attorney in assigned_contact_ids.';

comment on column public.cases.event_attorney_contact_id is
  'Optional DocketFlow-only attorney for calendar event invites; not in assigned_contact_ids.';
