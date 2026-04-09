import { google } from "googleapis";

const MAX_REMINDER_MIN = 40320;

function getAuthClient() {
  const clientEmail = process.env.GOOGLE_CLIENT_EMAIL;
  const privateKey = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n");
  const impersonate = process.env.GOOGLE_IMPERSONATE_EMAIL;

  if (!clientEmail || !privateKey) {
    throw new Error("Set GOOGLE_CLIENT_EMAIL and GOOGLE_PRIVATE_KEY for Calendar API");
  }
  if (!impersonate) {
    throw new Error("Set GOOGLE_IMPERSONATE_EMAIL to a @ramosjames.com user for DWD impersonation");
  }

  return new google.auth.JWT({
    email: clientEmail,
    key: privateKey,
    scopes: ["https://www.googleapis.com/auth/calendar.events"],
    subject: impersonate,
  });
}

function getCalendarId(): string {
  return process.env.GOOGLE_CALENDAR_ID || "primary";
}

export async function insertGoogleEvent(params: {
  summary: string;
  description: string;
  dateIso: string;
  attendeeEmails: string[];
  reminderMinutes: number[];
}): Promise<string> {
  const auth = getAuthClient();
  const calendar = google.calendar({ version: "v3", auth });

  const calendarId = getCalendarId();
  const start = `${params.dateIso}T09:00:00`;
  const end = `${params.dateIso}T10:00:00`;

  const overrides = params.reminderMinutes
    .filter((m) => m >= 0 && m <= MAX_REMINDER_MIN)
    .slice(0, 5)
    .map((minutes) => ({ method: "popup" as const, minutes }));

  console.log("[calendar] INSERT calendarId:", calendarId);
  console.log("[calendar] INSERT reminders:", JSON.stringify({ useDefault: false, overrides }));

  const res = await calendar.events.insert({
    calendarId,
    sendUpdates: params.attendeeEmails.length ? "all" : "none",
    requestBody: {
      summary: params.summary,
      description: params.description,
      start: { dateTime: start, timeZone: "America/Chicago" },
      end: { dateTime: end, timeZone: "America/Chicago" },
      attendees: params.attendeeEmails.map((email) => ({ email })),
      reminders: {
        useDefault: false,
        overrides,
      },
    },
  });

  console.log("[calendar] RESPONSE id:", res.data.id, "reminders:", JSON.stringify(res.data.reminders));

  if (!res.data.id) {
    throw new Error("Calendar API did not return event id");
  }
  return res.data.id;
}

export async function patchGoogleEvent(params: {
  googleEventId: string;
  summary?: string;
  description?: string;
  dateIso?: string;
  attendeeEmails?: string[];
  reminderMinutes?: number[];
}): Promise<void> {
  const auth = getAuthClient();
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
    const overrides = params.reminderMinutes
      .filter((m) => m >= 0 && m <= MAX_REMINDER_MIN)
      .slice(0, 5)
      .map((minutes) => ({ method: "popup" as const, minutes }));
    body.reminders = { useDefault: false, overrides };
  }
  if (params.attendeeEmails?.length) {
    body.attendees = params.attendeeEmails.map((email) => ({ email }));
  }

  await calendar.events.patch({
    calendarId: getCalendarId(),
    eventId: params.googleEventId,
    sendUpdates: params.attendeeEmails?.length ? "all" : "none",
    requestBody: body,
  });
}

export async function deleteGoogleEvent(googleEventId: string): Promise<void> {
  const auth = getAuthClient();
  const calendar = google.calendar({ version: "v3", auth });
  await calendar.events.delete({
    calendarId: getCalendarId(),
    eventId: googleEventId,
    sendUpdates: "all",
  });
}
