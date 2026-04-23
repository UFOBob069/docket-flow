import type { CalendarEvent, CalendarEventOrigin } from "./types";

export function normalizeCalendarOrigin(o: CalendarEventOrigin | undefined): CalendarEventOrigin {
  return o ?? "docketflow";
}

/** True when this row is a mirror of Google Calendar data, not managed by DocketFlow's sync API. */
export function isGoogleIcsMirrorEvent(ev: Pick<CalendarEvent, "calendarOrigin">): boolean {
  return normalizeCalendarOrigin(ev.calendarOrigin) === "google_ics_mirror";
}
