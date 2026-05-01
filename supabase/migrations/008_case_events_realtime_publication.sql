-- Include case_events in supabase_realtime so client subscriptions (e.g. subscribeCaseEventsFirm) receive inserts.
-- Safe if the table is already a publication member (IF NOT EXISTS guard).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'case_events'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.case_events;
  END IF;
END
$$;
