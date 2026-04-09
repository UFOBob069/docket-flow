import { google } from "googleapis";

const MAX_REMINDER_MIN = 40320;

/**
 * Build a JWT client that impersonates `subject`.
 * With DWD, the service account can impersonate any @ramosjames.com user,
 * so we create events directly on each person's calendar.
 */
function getAuthForUser(subject: string) {
  const clientEmail = process.env.GOOGLE_CLIENT_EMAIL;
  const privateKey = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n");

  if (!clientEmail || !privateKey) {
    throw new Error("Set GOOGLE_CLIENT_EMAIL and GOOGLE_PRIVATE_KEY for Calendar API");
  }

  return new google.auth.JWT({
    email: clientEmail,
    key: privateKey,
    scopes: ["https://www.googleapis.com/auth/calendar.events"],
    subject,
  });
}

function getDefaultUser(): string {
  const email = process.env.GOOGLE_IMPERSONATE_EMAIL;
  if (!email) {
    throw new Error("Set GOOGLE_IMPERSONATE_EMAIL to a @ramosjames.com user");
  }
  return email;
}

function buildOverrides(minutes: number[]) {
  return minutes
    .filter((m) => m >= 0 && m <= MAX_REMINDER_MIN)
    .slice(0, 5)
    .map((m) => ({ method: "popup" as const, minutes: m }));
}

/**
 * Create the event on EACH attendee's primary calendar (via DWD impersonation).
 * This makes reminders native to each person — no invite needed.
 * Returns the event ID from the organizer's (default user) calendar.
 */
export async function insertGoogleEvent(params: {
  summary: string;
  description: string;
  dateIso: string;
  attendeeEmails: string[];
  reminderMinutes: number[];
}): Promise<string> {
  const defaultUser = getDefaultUser();
  const start = `${params.dateIso}T09:00:00`;
  const end = `${params.dateIso}T10:00:00`;
  const overrides = buildOverrides(params.reminderMinutes);

  const eventBody = {
    summary: params.summary,
    description: params.description,
    start: { dateTime: start, timeZone: "America/Chicago" },
    end: { dateTime: end, timeZone: "America/Chicago" },
    reminders: { useDefault: false, overrides },
  };

  // Dedupe: all unique @ramosjames.com users who should get this event
  const allRecipients = Array.from(
    new Set([defaultUser, ...params.attendeeEmails].map((e) => e.toLowerCase()))
  );

  let organizerEventId = "";

  for (const userEmail of allRecipients) {
    try {
      const auth = getAuthForUser(userEmail);
      const calendar = google.calendar({ version: "v3", auth });

      console.log("[calendar] Creating event on", userEmail, "reminders:", JSON.stringify(overrides));

      const res = await calendar.events.insert({
        calendarId: "primary",
        requestBody: eventBody,
      });

      console.log("[calendar]", userEmail, "→ eventId:", res.data.id);

      if (userEmail.toLowerCase() === defaultUser.toLowerCase()) {
        organizerEventId = res.data.id ?? "";
      }
    } catch (err) {
      // Non-domain emails (gmail, etc.) can't be impersonated — skip silently
      const msg = err instanceof Error ? err.message : String(err);
      console.warn("[calendar] Could not create event for", userEmail, ":", msg);
    }
  }

  if (!organizerEventId) {
    throw new Error("Failed to create event on organizer calendar");
  }
  return organizerEventId;
}

export async function patchGoogleEvent(params: {
  googleEventId: string;
  summary?: string;
  description?: string;
  dateIso?: string;
  attendeeEmails?: string[];
  reminderMinutes?: number[];
}): Promise<void> {
  const auth = getAuthForUser(getDefaultUser());
  const calendar = google.calendar({ version: "v3", auth });

  const body: Record<string, unknown> = {};
  if (params.summary !== undefined) body.summary = params.summary;
  if (params.description !== undefined) body.description = params.description;
  if (params.dateIso !== undefined) {
    const start = `${params.dateIso}T09:00:00`;
    const end = `${params.dateIso}T10:00:00`;
    body.start = { dateTime: start, timeZone: "America/Chicago" };
    body.end = { dateTime: end, timeZone: "America/Chicago" };
  }
  if (params.reminderMinutes?.length) {
    body.reminders = { useDefault: false, overrides: buildOverrides(params.reminderMinutes) };
  }

  await calendar.events.patch({
    calendarId: "primary",
    eventId: params.googleEventId,
    requestBody: body,
  });
}

export async function deleteGoogleEvent(googleEventId: string): Promise<void> {
  const auth = getAuthForUser(getDefaultUser());
  const calendar = google.calendar({ version: "v3", auth });
  await calendar.events.delete({
    calendarId: "primary",
    eventId: googleEventId,
  });
}
