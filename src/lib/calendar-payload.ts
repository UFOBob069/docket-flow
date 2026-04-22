import type { CalendarEvent } from "./types";

/** Rich description for Google Calendar (join link, deponent, etc. live in DB fields). */
export function googleCalendarDescription(
  ev: Pick<CalendarEvent, "description" | "deponentOrSubject" | "externalAttendeesText" | "zoomLink">
): string {
  const parts: string[] = [];
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
  /** Shown in Google Calendar as Location (good for Zoom URLs on mobile). */
  location?: string;
};

export type CalendarBatchItem = CreateCalendarEventInput & {
  sourceEventIds: string[];
};

/** Turns reviewed events into API create payload — one calendar event per included deadline. */
export function buildCalendarBatches(events: CalendarEvent[]): CalendarBatchItem[] {
  return events
    .filter((e) => e.included)
    .map((e) => ({
      title: e.title,
      date: e.date,
      description: googleCalendarDescription(e),
      reminderMinutes: e.remindersMinutes,
      ...(e.startDateTime ? { startDateTime: e.startDateTime } : {}),
      ...(e.endDateTime ? { endDateTime: e.endDateTime } : {}),
      ...(e.zoomLink?.trim() ? { location: e.zoomLink.trim() } : {}),
      sourceEventIds: [e.id],
    }));
}
