import { CALENDAR_TIMEZONE } from "@/lib/event-factory";

const partsFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: CALENDAR_TIMEZONE,
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

function zonedParts(utcMs: number): Record<string, number> {
  const out: Record<string, number> = {};
  for (const p of partsFormatter.formatToParts(new Date(utcMs))) {
    if (p.type !== "literal") out[p.type] = Number(p.value);
  }
  return out;
}

function offsetMs(utcMs: number): number {
  const p = zonedParts(utcMs);
  const asUtc = Date.UTC(p.year!, p.month! - 1, p.day!, p.hour! % 24, p.minute!, p.second!);
  return asUtc - Math.floor(utcMs / 1000) * 1000;
}

/** Firm wall-clock date + `HH:mm` (America/Chicago) → UTC ISO string (DST-aware). */
export function chicagoLocalToIso(ymd: string, hhmm: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const [h, mi] = hhmm.split(":").map(Number);
  const guess = Date.UTC(y!, m! - 1, d!, h!, mi!);
  let t = guess - offsetMs(guess);
  const second = offsetMs(t);
  if (guess - second !== t) t = guess - second;
  return new Date(t).toISOString();
}

/** ISO instant → firm wall-clock `{ date: YYYY-MM-DD, time: HH:mm }`. */
export function isoToChicagoParts(iso: string): { date: string; time: string } | null {
  const ms = new Date(iso).getTime();
  if (Number.isNaN(ms)) return null;
  const p = zonedParts(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return {
    date: `${p.year}-${pad(p.month!)}-${pad(p.day!)}`,
    time: `${pad(p.hour! % 24)}:${pad(p.minute!)}`,
  };
}

export function todayChicagoYmd(): string {
  return isoToChicagoParts(new Date().toISOString())!.date;
}

export function addDaysYmd(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1, d! + days));
  return dt.toISOString().slice(0, 10);
}

export type ParsedWhen = { date: string; time: string | null };

/**
 * Accepts `YYYY-MM-DD` (all-day), `YYYY-MM-DDTHH:mm` / `YYYY-MM-DD HH:mm` (firm Chicago time),
 * or a full ISO instant with `Z` / offset (converted to Chicago wall clock).
 */
export function parseWhen(raw: string): ParsedWhen | null {
  const s = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return isValidYmd(s) ? { date: s, time: null } : null;
  if (/[zZ]$|[+-]\d{2}:?\d{2}$/.test(s) && /T\d{2}:\d{2}/.test(s)) {
    const parts = isoToChicagoParts(s);
    return parts ? { date: parts.date, time: parts.time } : null;
  }
  const m = /^(\d{4}-\d{2}-\d{2})[T ](\d{1,2}):(\d{2})(?::\d{2}(?:\.\d+)?)?$/.exec(s);
  if (!m) return null;
  const hour = Number(m[2]);
  const minute = Number(m[3]);
  if (!isValidYmd(m[1]!) || hour > 23 || minute > 59) return null;
  return { date: m[1]!, time: `${String(hour).padStart(2, "0")}:${m[3]}` };
}

function isValidYmd(ymd: string): boolean {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1, d!));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m! - 1 && dt.getUTCDate() === d;
}
