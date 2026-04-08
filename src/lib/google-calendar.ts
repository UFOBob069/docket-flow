import { google } from "googleapis";

const MAX_REMINDER_MIN = 40320; // Google Calendar API hard limit (4 weeks)

function getOAuth2Client() {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_OAUTH_REFRESH_TOKEN;

  const missing: string[] = [];
  if (!clientId) missing.push("GOOGLE_OAUTH_CLIENT_ID");
  if (!clientSecret) missing.push("GOOGLE_OAUTH_CLIENT_SECRET");
  if (!refreshToken) missing.push("GOOGLE_OAUTH_REFRESH_TOKEN");

  if (missing.length) {
    throw new Error(`Missing env vars: ${missing.join(", ")}. Restart the dev server after updating .env.local`);
  }

  const oauth2 = new google.auth.OAuth2(clientId, clientSecret);
  oauth2.setCredentials({ refresh_token: refreshToken });
  return oauth2;
}

function getCalendarId(): string {
  return process.env.GOOGLE_CALENDAR_ID ?? "primary";
}

export async function insertGoogleEvent(params: {
  summary: string;
  description: string;
  dateIso: string;
  attendeeEmails: string[];
  reminderMinutes: number[];
}): Promise<string> {
  const auth = getOAuth2Client();
  const calendar = google.calendar({ version: "v3", auth });

  const start = `${params.dateIso}T09:00:00`;
  const end = `${params.dateIso}T10:00:00`;

  const res = await calendar.events.insert({
    calendarId: getCalendarId(),
    sendUpdates: params.attendeeEmails.length ? "all" : "none",
    requestBody: {
      summary: params.summary,
      description: params.description,
      start: { dateTime: start, timeZone: "America/Chicago" },
      end: { dateTime: end, timeZone: "America/Chicago" },
      attendees: params.attendeeEmails.map((email) => ({ email })),
      reminders: {
        useDefault: false,
        overrides: params.reminderMinutes
          .filter((m) => m >= 0 && m <= MAX_REMINDER_MIN)
          .map((minutes) => ({ method: "popup" as const, minutes })),
      },
    },
  });

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
  const auth = getOAuth2Client();
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
    body.reminders = {
      useDefault: false,
      overrides: params.reminderMinutes
        .filter((m) => m >= 0 && m <= MAX_REMINDER_MIN)
        .map((minutes) => ({ method: "popup" as const, minutes })),
    };
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
  const auth = getOAuth2Client();
  const calendar = google.calendar({ version: "v3", auth });
  await calendar.events.delete({
    calendarId: getCalendarId(),
    eventId: googleEventId,
    sendUpdates: "all",
  });
}
