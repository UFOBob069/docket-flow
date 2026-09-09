import type { CalendarEvent } from "@/lib/types";
import { isGoogleIcsMirrorEvent } from "@/lib/calendar-event-origin";

export type CalendarDeleteSyncBody = {
  action: "delete";
  googleEventId: string;
  googleHostCalendarId?: string;
  googleCalendarEventIdsByEmail?: Record<string, string>;
  scheduleKind?: "deadline" | "meeting";
};

/** True when we should strip Google linkage from the DB row (non-ICS events only). */
export function eventNeedsGoogleCalendarClear(ev: CalendarEvent): boolean {
  if (isGoogleIcsMirrorEvent(ev)) return false;
  return Boolean(
    ev.googleEventId ||
      ev.googleHostCalendarId ||
      (ev.googleCalendarEventIdsByEmail &&
        Object.keys(ev.googleCalendarEventIdsByEmail).length > 0)
  );
}

/**
 * Delete body for `/api/calendar/sync`.
 * SOL host rows use `googleHostCalendarId` instead of per-user copies.
 * Returns null when there is no Google event id to delete (DB clear may still be needed).
 */
export function calendarDeletePayload(ev: CalendarEvent): CalendarDeleteSyncBody | null {
  if (isGoogleIcsMirrorEvent(ev)) return null;

  const map = ev.googleCalendarEventIdsByEmail;
  const fromMap =
    map && Object.keys(map).length > 0
      ? Object.values(map).find((id) => Boolean(id?.trim()))
      : undefined;
  const googleEventId = ev.googleEventId?.trim() || fromMap?.trim() || "";
  if (!googleEventId) return null;

  const base: CalendarDeleteSyncBody = {
    action: "delete",
    googleEventId,
    ...(ev.scheduleKind === "meeting" ? { scheduleKind: "meeting" as const } : {}),
  };
  if (ev.googleHostCalendarId) {
    return { ...base, googleHostCalendarId: ev.googleHostCalendarId };
  }
  if (map && Object.keys(map).length > 0) {
    return { ...base, googleCalendarEventIdsByEmail: map };
  }
  return base;
}
