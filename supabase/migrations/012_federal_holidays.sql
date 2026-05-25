-- US federal holidays (observed dates) for DocketFlow date validation.
-- Source: federal_holidays_2026_2035.csv (years 2026–2035, 11 holidays/year).

create table if not exists public.federal_holidays (
  observed_date date primary key,
  year integer not null check (year >= 2000 and year <= 2100),
  name text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_federal_holidays_year
  on public.federal_holidays (year);

comment on table public.federal_holidays is
  'Observed US federal holiday calendar days; match event date (YYYY-MM-DD) for warnings.';

-- Idempotent reload if re-run in SQL editor (optional).
truncate table public.federal_holidays;

insert into public.federal_holidays (year, name, observed_date) values
  (2026, 'New Year''s Day', '2026-01-01'),
  (2026, 'Martin Luther King Jr. Day', '2026-01-19'),
  (2026, 'Presidents'' Day', '2026-02-16'),
  (2026, 'Memorial Day', '2026-05-25'),
  (2026, 'Juneteenth', '2026-06-19'),
  (2026, 'Independence Day', '2026-07-03'),
  (2026, 'Labor Day', '2026-09-07'),
  (2026, 'Columbus Day', '2026-10-12'),
  (2026, 'Veterans Day', '2026-11-11'),
  (2026, 'Thanksgiving Day', '2026-11-26'),
  (2026, 'Christmas Day', '2026-12-25'),
  (2027, 'New Year''s Day', '2027-01-01'),
  (2027, 'Martin Luther King Jr. Day', '2027-01-18'),
  (2027, 'Presidents'' Day', '2027-02-15'),
  (2027, 'Memorial Day', '2027-05-31'),
  (2027, 'Juneteenth', '2027-06-18'),
  (2027, 'Independence Day', '2027-07-05'),
  (2027, 'Labor Day', '2027-09-06'),
  (2027, 'Columbus Day', '2027-10-11'),
  (2027, 'Veterans Day', '2027-11-11'),
  (2027, 'Thanksgiving Day', '2027-11-25'),
  (2027, 'Christmas Day', '2027-12-24'),
  (2028, 'New Year''s Day', '2027-12-31'),
  (2028, 'Martin Luther King Jr. Day', '2028-01-17'),
  (2028, 'Presidents'' Day', '2028-02-21'),
  (2028, 'Memorial Day', '2028-05-29'),
  (2028, 'Juneteenth', '2028-06-19'),
  (2028, 'Independence Day', '2028-07-04'),
  (2028, 'Labor Day', '2028-09-04'),
  (2028, 'Columbus Day', '2028-10-09'),
  (2028, 'Veterans Day', '2028-11-10'),
  (2028, 'Thanksgiving Day', '2028-11-23'),
  (2028, 'Christmas Day', '2028-12-25'),
  (2029, 'New Year''s Day', '2029-01-01'),
  (2029, 'Martin Luther King Jr. Day', '2029-01-15'),
  (2029, 'Presidents'' Day', '2029-02-19'),
  (2029, 'Memorial Day', '2029-05-28'),
  (2029, 'Juneteenth', '2029-06-19'),
  (2029, 'Independence Day', '2029-07-04'),
  (2029, 'Labor Day', '2029-09-03'),
  (2029, 'Columbus Day', '2029-10-08'),
  (2029, 'Veterans Day', '2029-11-12'),
  (2029, 'Thanksgiving Day', '2029-11-22'),
  (2029, 'Christmas Day', '2029-12-25'),
  (2030, 'New Year''s Day', '2030-01-01'),
  (2030, 'Martin Luther King Jr. Day', '2030-01-21'),
  (2030, 'Presidents'' Day', '2030-02-18'),
  (2030, 'Memorial Day', '2030-05-27'),
  (2030, 'Juneteenth', '2030-06-19'),
  (2030, 'Independence Day', '2030-07-04'),
  (2030, 'Labor Day', '2030-09-02'),
  (2030, 'Columbus Day', '2030-10-14'),
  (2030, 'Veterans Day', '2030-11-11'),
  (2030, 'Thanksgiving Day', '2030-11-28'),
  (2030, 'Christmas Day', '2030-12-25'),
  (2031, 'New Year''s Day', '2031-01-01'),
  (2031, 'Martin Luther King Jr. Day', '2031-01-20'),
  (2031, 'Presidents'' Day', '2031-02-17'),
  (2031, 'Memorial Day', '2031-05-26'),
  (2031, 'Juneteenth', '2031-06-19'),
  (2031, 'Independence Day', '2031-07-04'),
  (2031, 'Labor Day', '2031-09-01'),
  (2031, 'Columbus Day', '2031-10-13'),
  (2031, 'Veterans Day', '2031-11-11'),
  (2031, 'Thanksgiving Day', '2031-11-27'),
  (2031, 'Christmas Day', '2031-12-25'),
  (2032, 'New Year''s Day', '2032-01-01'),
  (2032, 'Martin Luther King Jr. Day', '2032-01-19'),
  (2032, 'Presidents'' Day', '2032-02-16'),
  (2032, 'Memorial Day', '2032-05-31'),
  (2032, 'Juneteenth', '2032-06-18'),
  (2032, 'Independence Day', '2032-07-05'),
  (2032, 'Labor Day', '2032-09-06'),
  (2032, 'Columbus Day', '2032-10-11'),
  (2032, 'Veterans Day', '2032-11-11'),
  (2032, 'Thanksgiving Day', '2032-11-25'),
  (2032, 'Christmas Day', '2032-12-24'),
  (2033, 'New Year''s Day', '2033-01-03'),
  (2033, 'Martin Luther King Jr. Day', '2033-01-17'),
  (2033, 'Presidents'' Day', '2033-02-21'),
  (2033, 'Memorial Day', '2033-05-30'),
  (2033, 'Juneteenth', '2033-06-20'),
  (2033, 'Independence Day', '2033-07-04'),
  (2033, 'Labor Day', '2033-09-05'),
  (2033, 'Columbus Day', '2033-10-10'),
  (2033, 'Veterans Day', '2033-11-11'),
  (2033, 'Thanksgiving Day', '2033-11-24'),
  (2033, 'Christmas Day', '2033-12-26'),
  (2034, 'New Year''s Day', '2034-01-02'),
  (2034, 'Martin Luther King Jr. Day', '2034-01-16'),
  (2034, 'Presidents'' Day', '2034-02-20'),
  (2034, 'Memorial Day', '2034-05-29'),
  (2034, 'Juneteenth', '2034-06-19'),
  (2034, 'Independence Day', '2034-07-04'),
  (2034, 'Labor Day', '2034-09-04'),
  (2034, 'Columbus Day', '2034-10-09'),
  (2034, 'Veterans Day', '2034-11-10'),
  (2034, 'Thanksgiving Day', '2034-11-23'),
  (2034, 'Christmas Day', '2034-12-25'),
  (2035, 'New Year''s Day', '2035-01-01'),
  (2035, 'Martin Luther King Jr. Day', '2035-01-15'),
  (2035, 'Presidents'' Day', '2035-02-19'),
  (2035, 'Memorial Day', '2035-05-28'),
  (2035, 'Juneteenth', '2035-06-19'),
  (2035, 'Independence Day', '2035-07-04'),
  (2035, 'Labor Day', '2035-09-03'),
  (2035, 'Columbus Day', '2035-10-08'),
  (2035, 'Veterans Day', '2035-11-12'),
  (2035, 'Thanksgiving Day', '2035-11-22'),
  (2035, 'Christmas Day', '2035-12-25');

alter table public.federal_holidays enable row level security;

drop policy if exists "federal_holidays_read_authenticated" on public.federal_holidays;
create policy "federal_holidays_read_authenticated"
  on public.federal_holidays
  for select
  to authenticated
  using (true);

grant select on public.federal_holidays to authenticated;
