-- One-shot pipeline fields for DocketFlow dashboard/cases (avoid paging whole tracker tables).
create or replace function public.case_tracker_pipeline_stats()
returns table (
  case_id uuid,
  case_stage text,
  disbursed_status text,
  check_disbursed_at timestamptz
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    e.case_id,
    e.case_stage,
    r.disbursed_status,
    r.check_disbursed_at
  from public.case_tracker_entries e
  left join public.case_tracker_results r on r.case_id = e.case_id;
$$;

grant execute on function public.case_tracker_pipeline_stats() to authenticated;
grant execute on function public.case_tracker_pipeline_stats() to service_role;
