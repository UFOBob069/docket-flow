import type { CalendarEvent, EventScheduleKind } from "./types";
import { normalizeGoogleCalendarInviteColorId } from "./google-calendar-invite-colors";

/** Rich description for Google Calendar (join link, deponent, etc. live in DB fields). */
export function googleCalendarDescription(
  ev: Pick<
    CalendarEvent,
    "description" | "deponentOrSubject" | "externalAttendeesText" | "zoomLink" | "scheduleKind" | "deadlineEndDate" | "date" | "startDateTime"
  >
): string {
  const parts: string[] = [];
  if (ev.scheduleKind === "meeting") {
    parts.push("Internal meeting (time-based)");
  }
  if (!ev.startDateTime && ev.deadlineEndDate && ev.deadlineEndDate.trim() > (ev.date ?? "").trim()) {
    parts.push(`Multi-day deadline through ${ev.deadlineEndDate.trim()} (inclusive).`);
  }
  if (ev.description?.trim()) parts.push(ev.description.trim());
  if (ev.deponentOrSubject?.trim()) parts.push(`Deponent / subject: ${ev.deponentOrSubject.trim()}`);
  if (ev.externalAttendeesText?.trim()) parts.push(`Attendees / parties: ${ev.externalAttendeesText.trim()}`);
  if (ev.zoomLink?.trim()) parts.push(`Join (Zoom / video): ${ev.zoomLink.trim()}`);
  return parts.join("\n\n");
}

export type CreateCalendarEventInput = {
  title: string;
  date: string;
  description: string;
  reminderMinutes?: number[];
  startDateTime?: string;
  endDateTime?: string;
  /** Inclusive last day for multi-day all-day deadlines. */
  deadlineEndDate?: string | null;
  /** Shown in Google Calendar as Location (good for Zoom URLs on mobile). */
  location?: string;
  scheduleKind?: EventScheduleKind;
  /** Google Calendar API `colorId` (Peacock, Lavender, …). */
  googleColorId?: string | null;
};

export type CalendarBatchItem = CreateCalendarEventInput & {
  sourceEventIds: string[];
};

/** Turns reviewed events into API create payload — one calendar event per included deadline. */
export function buildCalendarBatches(events: CalendarEvent[]): CalendarBatchItem[] {
  return events
    .filter((e) => e.included && !e.completed)
    .map((e) => {
      const gc = normalizeGoogleCalendarInviteColorId(e.googleColorId ?? undefined);
      return {
        title: e.title,
        date: e.date,
        description: googleCalendarDescription(e),
        reminderMinutes: e.remindersMinutes,
        scheduleKind: e.scheduleKind,
        ...(e.startDateTime ? { startDateTime: e.startDateTime } : {}),
        ...(e.endDateTime ? { endDateTime: e.endDateTime } : {}),
        ...(e.deadlineEndDate && !e.startDateTime ? { deadlineEndDate: e.deadlineEndDate } : {}),
        ...(e.zoomLink?.trim() ? { location: e.zoomLink.trim() } : {}),
        ...(gc != null ? { googleColorId: gc } : e.googleColorId === null ? { googleColorId: null } : {}),
        sourceEventIds: [e.id],
      };
    });
}
