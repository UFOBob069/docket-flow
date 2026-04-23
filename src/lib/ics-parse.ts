import ical, { expandRecurringEvent, type VEvent } from "node-ical";
import { CALENDAR_TIMEZONE } from "./event-factory";

export type ParsedIcsEvent = {
  icsUid: string;
  title: string;
  description: string;
  location: string | null;
  /** Calendar day in firm timezone (YYYY-MM-DD) */
  date: string;
  startDateTime: string | null;
  endDateTime: string | null;
  allDay: boolean;
};

function todayYmdInTz(tz: string): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: tz });
}

function ymdInTz(d: Date, tz: string): string {
  return d.toLocaleDateString("en-CA", { timeZone: tz });
}

function paramText(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "object" && v !== null && "val" in v) {
    const x = (v as { val: unknown }).val;
    return x == null ? "" : String(x);
  }
  return String(v);
}

function asDate(d: unknown): Date | null {
  return d instanceof Date && !Number.isNaN(d.getTime()) ? d : null;
}

/** VEVENTs from parseICS (values only; skip vcalendar and timezones). */
function listVEvents(cal: ical.CalendarResponse): VEvent[] {
  const out: VEvent[] = [];
  for (const key of Object.keys(cal)) {
    if (key === "vcalendar") continue;
    const comp = cal[key];
    if (comp && typeof comp === "object" && (comp as { type?: string }).type === "VEVENT") {
      out.push(comp as VEvent);
    }
  }
  return out;
}

/**
 * Parse ICS text; return events from today (in {@link CALENDAR_TIMEZONE}) through ~3y ahead.
 * Recurring events are expanded; instances are keyed with stable synthetic UIDs.
 */
export function parseIcsToFutureEvents(icsContent: string): ParsedIcsEvent[] {
  const tz = CALENDAR_TIMEZONE;
  const todayYmd = todayYmdInTz(tz);
  const cal = ical.parseICS(icsContent);
  const vevents = listVEvents(cal);
  const horizon = new Date();
  horizon.setUTCFullYear(horizon.getUTCFullYear() + 3);
  const rangeStart = new Date();
  rangeStart.setUTCDate(rangeStart.getUTCDate() - 1);

  const rows: ParsedIcsEvent[] = [];

  for (const vevent of vevents) {
    if (vevent.status === "CANCELLED") continue;
    const title = paramText(vevent.summary).trim() || "Calendar event";
    const description = paramText(vevent.description).trim();
    const locationRaw = vevent.location !== undefined ? paramText(vevent.location).trim() : "";
    const location = locationRaw || null;

    if (vevent.rrule) {
      const instances = expandRecurringEvent(vevent, { from: rangeStart, to: horizon });
      for (const inst of instances) {
        const start = asDate(inst.start);
        if (!start) continue;
        if (ymdInTz(start, tz) < todayYmd) continue;
        const end = asDate(inst.end);
        const uid = `${vevent.uid}#${start.toISOString()}`;
        rows.push(
          inst.isFullDay
            ? {
                icsUid: uid,
                title,
                description,
                location,
                date: ymdInTz(start, tz),
                startDateTime: null,
                endDateTime: null,
                allDay: true,
              }
            : {
                icsUid: uid,
                title,
                description,
                location,
                date: ymdInTz(start, tz),
                startDateTime: start.toISOString(),
                endDateTime: end ? end.toISOString() : null,
                allDay: false,
              }
        );
      }
      continue;
    }

    const start = asDate(vevent.start);
    if (!start) continue;
    if (ymdInTz(start, tz) < todayYmd) continue;
    const end = asDate(vevent.end ?? undefined);
    const allDay = vevent.datetype === "date";
    rows.push(
      allDay
        ? {
            icsUid: vevent.uid,
            title,
            description,
            location,
            date: ymdInTz(start, tz),
            startDateTime: null,
            endDateTime: null,
            allDay: true,
          }
        : {
            icsUid: vevent.uid,
            title,
            description,
            location,
            date: ymdInTz(start, tz),
            startDateTime: start.toISOString(),
            endDateTime: end ? end.toISOString() : null,
            allDay: false,
          }
    );
  }

  rows.sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title));
  return rows;
}
