import type { CalendarEvent } from "./types";

/** Sort key for list views: calendar day, then time-of-day, then title. */
export function compareEventsBySchedule(a: CalendarEvent, b: CalendarEvent): number {
  const d = a.date.localeCompare(b.date);
  if (d !== 0) return d;
  const ta = a.startDateTime ?? "";
  const tb = b.startDateTime ?? "";
  if (ta !== tb) return ta.localeCompare(tb);
  const ca = a.completed ? 1 : 0;
  const cb = b.completed ? 1 : 0;
  if (ca !== cb) return ca - cb;
  return a.title.localeCompare(b.title);
}
