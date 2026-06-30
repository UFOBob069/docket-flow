alter table public.cases
  add column if not exists client_first_name text,
  add column if not exists client_last_name text,
  add column if not exists client_phone text,
  add column if not exists quo_contact_id text;

comment on column public.cases.client_name is
  'Display client name (First Last). Kept in sync with client_first_name + client_last_name for shared apps.';
comment on column public.cases.client_first_name is 'Client given name.';
comment on column public.cases.client_last_name is 'Client family name (without case number).';
comment on column public.cases.client_phone is 'Client phone in E.164 when synced to Quo.';
comment on column public.cases.quo_contact_id is 'Quo (OpenPhone) contact id from API create.';
