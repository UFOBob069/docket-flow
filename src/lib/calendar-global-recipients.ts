import { createClient } from "@supabase/supabase-js";

/** Dedupe + normalize emails for calendar recipient lists. */
export function mergeAttendeeEmailLists(...lists: string[][]): string[] {
  return Array.from(
    new Set(lists.flat().map((e) => e.trim().toLowerCase()).filter(Boolean))
  );
}

/**
 * Contacts flagged “all firm events” always receive a calendar copy (merged in /api/calendar/sync).
 * Uses the caller’s JWT so firm-wide RLS applies.
 */
export async function fetchAllFirmEventsContactEmails(
  authorizationHeader: string | null
): Promise<string[]> {
  if (!authorizationHeader?.startsWith("Bearer ")) return [];
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) return [];

  const supabase = createClient(url, anon, {
    global: { headers: { Authorization: authorizationHeader } },
  });

  const { data, error } = await supabase
    .from("contacts")
    .select("email")
    .eq("team_calendar_scope", "all_firm_events");

  if (error || !data?.length) return [];

  return Array.from(
    new Set(
      data
        .map((r) => String((r as { email: string }).email ?? "").trim().toLowerCase())
        .filter(Boolean)
    )
  );
}
