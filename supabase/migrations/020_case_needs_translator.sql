alter table public.cases
  add column if not exists needs_translator boolean not null default false;

comment on column public.cases.needs_translator is
  'Whether the client needs a translator. Defaults false for English; often true for Spanish.';
