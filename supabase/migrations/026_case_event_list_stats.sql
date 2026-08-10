-- Aggregate event counts for Cases list without shipping every event row over PostgREST.
create or replace function public.case_event_list_stats(today_ymd text)
returns table (
  case_id uuid,
  event_count bigint,
  overdue_count bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    e.case_id,
    count(*)::bigint as event_count,
    count(*) filter (
      where coalesce(e.included, true)
        and coalesce(e.completed, false) = false
        and coalesce(e.noise_flag, false) = false
        and coalesce(e.deadline_end_date, (e.date)::date) < (today_ymd)::date
    )::bigint as overdue_count
  from public.case_events e
  group by e.case_id;
$$;

grant execute on function public.case_event_list_stats(text) to authenticated;
grant execute on function public.case_event_list_stats(text) to service_role;
