import { google } from "googleapis";

const MAX_REMINDER_MIN = 40320;

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

type EventPayload = {
  summary: string;
  description: string;
  dateIso: string;
  reminderMinutes: number[];
};

async function insertCalendarEventForUser(
  userEmail: string,
  params: EventPayload
): Promise<string> {
  const auth = getAuthForUser(userEmail);
  const calendar = google.calendar({ version: "v3", auth });
  const overrides = buildOverrides(params.reminderMinutes);
  const res = await calendar.events.insert({
    calendarId: "primary",
    requestBody: {
      summary: params.summary,
      description: params.description,
      start: { date: params.dateIso },
      end: { date: params.dateIso },
      reminders: { useDefault: false, overrides },
    },
  });
  return res.data.id ?? "";
}

async function deleteCalendarEventForUser(
  userEmail: string,
  eventId: string
): Promise<void> {
  const auth = getAuthForUser(userEmail);
  const calendar = google.calendar({ version: "v3", auth });
  await calendar.events.delete({ calendarId: "primary", eventId });
}

function buildPatchBody(params: {
  summary?: string;
  description?: string;
  dateIso?: string;
  reminderMinutes?: number[];
}): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  if (params.summary !== undefined) body.summary = params.summary;
  if (params.description !== undefined) body.description = params.description;
  if (params.dateIso !== undefined) {
    body.start = { date: params.dateIso };
    body.end = { date: params.dateIso };
  }
  if (params.reminderMinutes?.length) {
    body.reminders = {
      useDefault: false,
      overrides: buildOverrides(params.reminderMinutes),
    };
  }
  return body;
}

async function patchCalendarEventForUser(
  userEmail: string,
  eventId: string,
  patchBody: Record<string, unknown>
): Promise<void> {
  if (Object.keys(patchBody).length === 0) return;
  const auth = getAuthForUser(userEmail);
  const calendar = google.calendar({ version: "v3", auth });
  await calendar.events.patch({
    calendarId: "primary",
    eventId,
    requestBody: patchBody,
  });
}

/**
 * Create the event on EACH attendee's primary calendar (via DWD impersonation).
 * Returns organizer's id (for backward compat) and every copy keyed by lowercased email.
 */
export async function insertGoogleEvent(params: {
  summary: string;
  description: string;
  dateIso: string;
  attendeeEmails: string[];
  reminderMinutes: number[];
}): Promise<{ organizerEventId: string; idsByEmail: Record<string, string> }> {
  const defaultUser = getDefaultUser();
  const payload: EventPayload = {
    summary: params.summary,
    description: params.description,
    dateIso: params.dateIso,
    reminderMinutes: params.reminderMinutes,
  };

  const allRecipients = Array.from(
    new Set([defaultUser, ...params.attendeeEmails].map((e) => e.toLowerCase()))
  );

  const idsByEmail: Record<string, string> = {};

  for (const userEmail of allRecipients) {
    try {
      console.log("[calendar] Creating event on", userEmail);
      const id = await insertCalendarEventForUser(userEmail, payload);
      if (id) idsByEmail[userEmail.toLowerCase()] = id;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn("[calendar] Could not create event for", userEmail, ":", msg);
    }
  }

  const organizerEventId =
    idsByEmail[defaultUser.toLowerCase()] ?? Object.values(idsByEmail)[0] ?? "";

  if (!organizerEventId) {
    throw new Error("Failed to create event on organizer calendar");
  }

  return { organizerEventId, idsByEmail };
}

export async function patchGoogleEvent(params: {
  googleEventId?: string;
  /** When set, patch every copy so non-organizer calendars stay in sync */
  idsByEmail?: Record<string, string>;
  summary?: string;
  description?: string;
  dateIso?: string;
  reminderMinutes?: number[];
}): Promise<void> {
  const patchBody = buildPatchBody(params);
  if (Object.keys(patchBody).length === 0) return;

  const defaultUser = getDefaultUser();
  const entries: [string, string][] =
    params.idsByEmail && Object.keys(params.idsByEmail).length > 0
      ? Object.entries(params.idsByEmail)
      : params.googleEventId
        ? [[defaultUser.toLowerCase(), params.googleEventId]]
        : [];

  for (const [email, eventId] of entries) {
    try {
      await patchCalendarEventForUser(email, eventId, patchBody);
    } catch (err) {
      console.warn("[calendar] Patch failed for", email, err);
    }
  }
}

/** Delete one calendar row (legacy) or every stored copy for the team */
export async function deleteGoogleEvent(
  googleEventId: string,
  idsByEmail?: Record<string, string>
): Promise<void> {
  if (idsByEmail && Object.keys(idsByEmail).length > 0) {
    for (const [email, eventId] of Object.entries(idsByEmail)) {
      try {
        await deleteCalendarEventForUser(email, eventId);
      } catch (err) {
        console.warn("[calendar] Delete failed for", email, err);
      }
    }
    return;
  }
  await deleteCalendarEventForUser(getDefaultUser(), googleEventId);
}

/**
 * After assigned contacts change: remove calendar rows for people no longer on the team,
 * add rows for new people, keep existing ids for people who stay.
 */
export async function reconcileCalendarEventTeam(params: {
  summary: string;
  description: string;
  dateIso: string;
  reminderMinutes: number[];
  attendeeEmails: string[];
  /** Prior map (may be partial for legacy events) */
  idsByEmail?: Record<string, string>;
  /** Legacy single id on organizer calendar only */
  googleEventId?: string;
}): Promise<{ idsByEmail: Record<string, string>; organizerEventId: string }> {
  const defaultUser = getDefaultUser();
  const defaultLower = defaultUser.toLowerCase();

  const newRecipients = Array.from(
    new Set([defaultLower, ...params.attendeeEmails.map((e) => e.toLowerCase())])
  );

  const oldMap: Record<string, string> = {};
  if (params.idsByEmail) {
    for (const [k, v] of Object.entries(params.idsByEmail)) {
      oldMap[k.toLowerCase()] = v;
    }
  }
  if (Object.keys(oldMap).length === 0 && params.googleEventId) {
    oldMap[defaultLower] = params.googleEventId;
  }

  const payload: EventPayload = {
    summary: params.summary,
    description: params.description,
    dateIso: params.dateIso,
    reminderMinutes: params.reminderMinutes,
  };

  for (const el of [...Object.keys(oldMap)]) {
    if (!newRecipients.includes(el)) {
      try {
        await deleteCalendarEventForUser(el, oldMap[el]!);
      } catch (err) {
        console.warn("[calendar] Reconcile delete failed for", el, err);
      }
      delete oldMap[el];
    }
  }

  const nextMap: Record<string, string> = {};
  for (const el of newRecipients) {
    const existing = oldMap[el];
    if (existing) {
      nextMap[el] = existing;
    } else {
      try {
        const id = await insertCalendarEventForUser(el, payload);
        if (id) nextMap[el] = id;
      } catch (err) {
        console.warn("[calendar] Reconcile insert failed for", el, err);
      }
    }
  }

  const organizerEventId = nextMap[defaultLower] ?? Object.values(nextMap)[0] ?? "";
  return { idsByEmail: nextMap, organizerEventId };
}
