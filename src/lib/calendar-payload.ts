import type { CalendarEvent } from "./types";

export type CreateCalendarEventInput = {
  title: string;
  date: string;
  description: string;
  reminderMinutes?: number[];
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
      description: e.description,
      reminderMinutes: e.remindersMinutes,
      sourceEventIds: [e.id],
    }));
}
