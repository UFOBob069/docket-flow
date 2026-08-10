-- Optional client email and mailing address on cases.
alter table public.cases
  add column if not exists client_email text,
  add column if not exists client_street_address text,
  add column if not exists client_city text,
  add column if not exists client_state text,
  add column if not exists client_zip text,
  add column if not exists client_country text;
