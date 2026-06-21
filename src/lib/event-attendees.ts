import { caseCalendarInviteContactIdsForEvent } from "@/lib/case-attorneys";
import { mergeAttendeeEmailLists, parseOneOffInviteEmails } from "@/lib/calendar-global-recipients";
import type { CalendarEvent, Case, Contact } from "@/lib/types";

const ONE_TIME_PREFIX = "One-time calendar invitees:";

/** Case assignees plus event attorney and event-specific extras (deduped). */
export function eventInviteContactIds(caseRecord: Case, event: CalendarEvent): string[] {
  return caseCalendarInviteContactIdsForEvent(caseRecord, event);
}

export function attendeeEmailsForEvent(
  caseRecord: Case,
  event: CalendarEvent,
  contacts: Contact[],
  additionalOneTimeEmails: string[] = []
): string[] {
  const ids = eventInviteContactIds(caseRecord, event);
  const fromContacts = ids
    .map((id) => contacts.find((c) => c.id === id)?.email)
    .filter((e): e is string => Boolean(e?.trim()))
    .map((e) => e.trim().toLowerCase());
  const storedOneTime = parseOneTimeEmailsFromExternalText(event.externalAttendeesText);
  return mergeAttendeeEmailLists(fromContacts, storedOneTime, additionalOneTimeEmails);
}

export function parseOneTimeEmailsFromExternalText(text: string | null | undefined): string[] {
  if (!text?.trim()) return [];
  const lines = text.split("\n");
  for (const line of lines) {
    const t = line.trim();
    if (t.toLowerCase().startsWith(ONE_TIME_PREFIX.toLowerCase())) {
      const raw = t.slice(ONE_TIME_PREFIX.length).trim();
      const parsed = parseOneOffInviteEmails(raw);
      return parsed.ok ? parsed.emails : [];
    }
  }
  return [];
}

/** External notes without the one-time email line (for display/editing other parties). */
export function externalTextWithoutOneTimeBlock(text: string | null | undefined): string {
  if (!text?.trim()) return "";
  return text
    .split("\n")
    .filter((line) => !line.trim().toLowerCase().startsWith(ONE_TIME_PREFIX.toLowerCase()))
    .join("\n")
    .trim();
}

export function mergeOneTimeEmailsIntoExternalText(
  existing: string | null | undefined,
  oneTimeEmails: string[]
): string | null {
  const base = externalTextWithoutOneTimeBlock(existing);
  const uniq = Array.from(new Set(oneTimeEmails.map((e) => e.trim().toLowerCase()).filter(Boolean)));
  const parts: string[] = [];
  if (base) parts.push(base);
  if (uniq.length) parts.push(`${ONE_TIME_PREFIX} ${uniq.join(", ")}`);
  return parts.length ? parts.join("\n\n") : null;
}

export function contactNamesForIds(ids: string[], contacts: Contact[]): string[] {
  return ids
    .map((id) => contacts.find((c) => c.id === id)?.name)
    .filter((n): n is string => Boolean(n?.trim()));
}

export function canManageEventAttendees(
  caseRecord: Case,
  event: CalendarEvent
): { ok: boolean; reason?: string } {
  if (caseRecord.status !== "active") {
    return { ok: false, reason: "Case is archived" };
  }
  if (!event.included) {
    return { ok: false, reason: "Event is excluded from calendar" };
  }
  if (event.calendarOrigin === "google_ics_mirror") {
    return { ok: false, reason: "Originally from Google — edit in Google Calendar" };
  }
  return { ok: true };
}
