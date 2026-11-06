-- Hide former staff from new-case assignment without removing them from historic cases.
alter table public.contacts
  add column if not exists available_for_new_cases boolean not null default true;

comment on column public.contacts.available_for_new_cases is
  'When false, contact stays on existing cases but is hidden from new-case and reassignment pickers.';
