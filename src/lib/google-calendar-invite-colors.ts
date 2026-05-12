/**
 * Google Calendar event palette (`events.insert` / `events.patch` `colorId`).
 * IDs match the Calendar API “event” color map (same names as the web UI).
 */
export const GOOGLE_CALENDAR_INVITE_COLOR_OPTIONS = [
  { id: "7", label: "Peacock", swatch: "#039be5" },
  { id: "1", label: "Lavender", swatch: "#7986cb" },
  { id: "2", label: "Sage", swatch: "#33b679" },
  { id: "4", label: "Flamingo", swatch: "#f06292" },
  { id: "11", label: "Tomato", swatch: "#d60000" },
] as const;

export type GoogleCalendarInviteColorId = (typeof GOOGLE_CALENDAR_INVITE_COLOR_OPTIONS)[number]["id"];

const ALLOWED = new Set<string>(GOOGLE_CALENDAR_INVITE_COLOR_OPTIONS.map((o) => o.id));

export function normalizeGoogleCalendarInviteColorId(
  raw: string | null | undefined
): GoogleCalendarInviteColorId | undefined {
  const s = raw == null ? "" : String(raw).trim();
  if (!s || !ALLOWED.has(s)) return undefined;
  return s as GoogleCalendarInviteColorId;
}
