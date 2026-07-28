-- Link promoted intakes to DocketFlow cases (router app owns intake row creation).
alter table public.intakes
  add column if not exists case_id uuid references public.cases (id) on delete set null;

create index if not exists intakes_case_id_idx on public.intakes (case_id)
  where case_id is not null;

create index if not exists intakes_name_lower_idx on public.intakes (lower(name))
  where name is not null and btrim(name) <> '';

create index if not exists intakes_phone_idx on public.intakes (phone)
  where phone is not null and btrim(phone) <> '';

comment on column public.intakes.case_id is
  'Set when DocketFlow promotes this intake to an active case.';
