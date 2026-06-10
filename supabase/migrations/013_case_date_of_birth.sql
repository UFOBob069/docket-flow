-- Client date of birth on cases (YYYY-MM-DD, required on new case form)
alter table public.cases
  add column if not exists date_of_birth text;
