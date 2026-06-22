alter table public.cases
  add column if not exists preferred_language text
  check (preferred_language is null or preferred_language in ('English', 'Spanish'));

comment on column public.cases.preferred_language is
  'Client preferred language (English or Spanish).';
