import { v4 as uuidv4 } from "uuid";
import type { CalendarEvent, EventCategory, EventKind } from "./types";
import { DEFAULT_REMINDERS } from "./reminder-presets";
import { categoryForManualEventKind } from "./one-off-events";
import { localDateTimePartsToIso } from "./five-minute-datetime";
import { buildSolMilestoneSpecs } from "./sol-milestones";

export const CALENDAR_TIMEZONE = "America/Chicago";

export function baseEvent(
  caseId: string,
  ownerId: string,
  overrides: Partial<CalendarEvent> & Pick<CalendarEvent, "title" | "date">
): CalendarEvent {
  const now = Date.now();
  return {
    id: uuidv4(),
    caseId,
    ownerId,
    description: "",
    category: "other",
    eventKind: "other_event",
    included: true,
    groupSuggested: false,
    mergeWithSameGroup: false,
    noiseFlag: false,
    remindersMinutes: [...DEFAULT_REMINDERS.other],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

/** Six SOL checkpoints (shared firm calendar) — dates dedupe if two offsets share a day. */
export function createSolMilestoneEvents(
  caseId: string,
  ownerId: string,
  solDateIso: string,
  incidentDateIso: string,
  finalReminderMinutes: number[],
  /** When set, event title matches Google: `{stem} - {name}` */
  calendarCaseName?: string
): CalendarEvent[] {
  const specs = buildSolMilestoneSpecs(solDateIso, incidentDateIso, finalReminderMinutes);
  const calName = calendarCaseName?.trim();
  return specs.map((s) =>
    baseEvent(caseId, ownerId, {
      title: calName ? `${s.googleSummaryStem} - ${calName}` : s.title,
      date: s.date,
      description: s.description,
      category: "other",
      eventKind: s.eventKind,
      remindersMinutes: s.reminderMinutes,
    })
  );
}

export function defaultEndIso(startIso: string): string {
  const d = new Date(startIso);
  if (Number.isNaN(d.getTime())) return startIso;
  d.setHours(d.getHours() + 1);
  return d.toISOString();
}

export function calendarDayFromDateTime(iso: string): string {
  return iso.slice(0, 10);
}

/** Timed firm event (deposition, call, etc.) — `date` is the calendar day of `startDateTime` in UTC; use with Chicago times in UI. */
export function createTimedOneOffEvent(
  caseId: string,
  ownerId: string,
  opts: {
    eventKind: EventKind;
    title: string;
    startDateTime: string;
    endDateTime: string;
    description: string;
    category?: EventCategory;
    deponentOrSubject?: string | null;
    externalAttendeesText?: string | null;
    zoomLink?: string | null;
    remindersMinutes: number[];
  }
): CalendarEvent {
  const date = calendarDayFromDateTime(opts.startDateTime);
  const category = opts.category ?? categoryForManualEventKind(opts.eventKind);
  return baseEvent(caseId, ownerId, {
    title: opts.title.trim(),
    date,
    description: opts.description.trim(),
    category,
    eventKind: opts.eventKind,
    startDateTime: opts.startDateTime,
    endDateTime: opts.endDateTime,
    deponentOrSubject: opts.deponentOrSubject?.trim() || null,
    externalAttendeesText: opts.externalAttendeesText?.trim() || null,
    zoomLink: opts.zoomLink?.trim() || null,
    remindersMinutes: [...opts.remindersMinutes],
  });
}

/** Manual case event: one calendar `eventDate`; optional `HH:mm` times on that day, or all-day if no start time. */
export function createAdHocCalendarEvent(
  caseId: string,
  ownerId: string,
  opts: {
    eventDate: string;
    startTime?: string | null;
    endTime?: string | null;
    eventKind: EventKind;
    title: string;
    description: string;
    category?: EventCategory;
    deponentOrSubject?: string | null;
    externalAttendeesText?: string | null;
    zoomLink?: string | null;
    remindersMinutes: number[];
  }
): CalendarEvent {
  const category = opts.category ?? categoryForManualEventKind(opts.eventKind);
  const common = {
    title: opts.title.trim(),
    description: opts.description.trim(),
    category,
    eventKind: opts.eventKind,
    deponentOrSubject: opts.deponentOrSubject?.trim() || null,
    externalAttendeesText: opts.externalAttendeesText?.trim() || null,
    zoomLink: opts.zoomLink?.trim() || null,
    remindersMinutes: [...opts.remindersMinutes],
  };
  if (opts.startTime) {
    const startIso = localDateTimePartsToIso(opts.eventDate, opts.startTime);
    const endIso = opts.endTime
      ? localDateTimePartsToIso(opts.eventDate, opts.endTime)
      : defaultEndIso(startIso);
    return baseEvent(caseId, ownerId, {
      ...common,
      date: opts.eventDate,
      startDateTime: startIso,
      endDateTime: endIso,
    });
  }
  return baseEvent(caseId, ownerId, {
    ...common,
    date: opts.eventDate,
    startDateTime: null,
    endDateTime: null,
  });
}
