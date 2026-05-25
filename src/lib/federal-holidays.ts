import { format, parseISO } from "date-fns";
import { eachYmdInInclusiveRange } from "@/lib/event-date-range";

/** observed_date (YYYY-MM-DD) → holiday name */
export type FederalHolidayIndex = ReadonlyMap<string, string>;

export function validateFederalHolidayDate(
  ymd: string,
  index: FederalHolidayIndex | null
): string | null {
  if (!index?.size || !ymd || !/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return null;
  const name = index.get(ymd);
  if (!name) return null;
  return `Federal holiday — ${name}. Events cannot be scheduled on this date. Choose another day.`;
}

export function validateFederalHolidaySpan(
  startYmd: string,
  endYmd: string,
  index: FederalHolidayIndex | null
): string | null {
  if (!index?.size || !startYmd || !endYmd || endYmd < startYmd) return null;
  const hits: { date: string; name: string }[] = [];
  for (const d of eachYmdInInclusiveRange(startYmd, endYmd)) {
    const name = index.get(d);
    if (name) hits.push({ date: d, name });
  }
  if (hits.length === 0) return null;
  if (hits.length === 1) {
    return validateFederalHolidayDate(hits[0]!.date, index);
  }
  const list = hits
    .map((h) => `${format(parseISO(h.date), "MMM d, yyyy")} (${h.name})`)
    .join("; ");
  return `This date range includes federal holidays: ${list}. No event day may fall on a federal holiday.`;
}

/** Event start date and optional multi-day deadline span (all-day only). */
export function validateEventScheduleAgainstFederalHolidays(
  schedule: {
    date: string;
    deadlineEndDate?: string | null;
    startDateTime?: string | null;
  },
  index: FederalHolidayIndex | null
): string | null {
  const onStart = validateFederalHolidayDate(schedule.date, index);
  if (onStart) return onStart;
  if (schedule.startDateTime) return null;
  const end = schedule.deadlineEndDate?.trim().slice(0, 10);
  if (end && end > schedule.date) {
    return validateFederalHolidaySpan(schedule.date, end, index);
  }
  return null;
}
