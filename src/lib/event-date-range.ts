import { addDays, endOfMonth, format, parseISO } from "date-fns";
import type { CalendarEvent } from "./types";

/** Last calendar day of an all-day deadline span (inclusive). Ignored for timed meetings. */
export function deadlineInclusiveEndDate(ev: CalendarEvent): string {
  if (ev.startDateTime) return ev.date;
  const last = ev.deadlineEndDate?.trim();
  if (last && last >= ev.date) return last;
  return ev.date;
}

/** YYYY-MM-DD strings in [start, end] inclusive (valid ISO dates). */
export function eachYmdInInclusiveRange(startYmd: string, endYmd: string): string[] {
  const a = parseISO(startYmd);
  const b = parseISO(endYmd);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime()) || a > b) return [startYmd];
  const out: string[] = [];
  for (let d = a; d <= b; d = addDays(d, 1)) {
    out.push(format(d, "yyyy-MM-dd"));
  }
  return out;
}

/** Shift a YYYY-MM-DD by whole calendar days (local date math via UTC noon). */
export function shiftCalendarDays(ymd: string, deltaDays: number): string {
  const d = new Date(`${ymd.trim().slice(0, 10)}T12:00:00`);
  d.setDate(d.getDate() + deltaDays);
  return d.toISOString().slice(0, 10);
}

export function eventIntersectsMonth(ev: CalendarEvent, yyyyMm: string): boolean {
  if (ev.date.length < 7) return false;
  const monthStart = `${yyyyMm}-01`;
  const anchor = parseISO(monthStart);
  if (Number.isNaN(anchor.getTime())) return ev.date.slice(0, 7) === yyyyMm;
  const monthEnd = format(endOfMonth(anchor), "yyyy-MM-dd");
  const start = ev.date;
  const end = deadlineInclusiveEndDate(ev);
  return start <= monthEnd && end >= monthStart;
}
