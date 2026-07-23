import { differenceInCalendarDays, parseISO } from "date-fns";
import type { SupabaseClient } from "@supabase/supabase-js";
import { deadlineInclusiveEndDate } from "@/lib/event-date-range";
import { markEventsCompleted } from "@/lib/supabase/repo";
import type { CalendarEvent } from "@/lib/types";

/** Days after an event's inclusive deadline end before it is auto-marked complete. */
export const AUTO_COMPLETE_DAYS_AFTER_DEADLINE = 3;

export function isEligibleForAutoComplete(ev: CalendarEvent, todayYmd: string): boolean {
  if (ev.completed || !ev.included) return false;
  const end = deadlineInclusiveEndDate(ev);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(end) || !/^\d{4}-\d{2}-\d{2}$/.test(todayYmd)) return false;
  return differenceInCalendarDays(parseISO(todayYmd), parseISO(end)) >= AUTO_COMPLETE_DAYS_AFTER_DEADLINE;
}

/**
 * Marks included, incomplete events complete when their deadline ended
 * {@link AUTO_COMPLETE_DAYS_AFTER_DEADLINE}+ calendar days ago.
 * Mutates `events` in place so callers can reuse the same arrays for UI.
 * @returns number of events updated
 */
export async function autoCompleteStaleEvents(
  supabase: SupabaseClient,
  events: CalendarEvent[],
  todayYmd: string
): Promise<number> {
  const stale = events.filter((e) => isEligibleForAutoComplete(e, todayYmd));
  if (!stale.length) return 0;
  const now = Date.now();
  await markEventsCompleted(
    supabase,
    stale.map((e) => e.id)
  );
  for (const e of stale) {
    e.completed = true;
    e.updatedAt = now;
  }
  return stale.length;
}
