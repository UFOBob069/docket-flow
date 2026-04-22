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

const DEFAULT_TZ = "America/Chicago";

type EventPayload = {
  summary: string;
  description: string;
  reminderMinutes: number[];
  /** All-day (YYYY-MM-DD) — omit when using timed */
  dateIso?: string;
  startDateTime?: string;
  endDateTime?: string;
  /** Zoom / meet link — surfaces prominently in Google Calendar */
  location?: string;
  timeZone?: string;
};

function isTimedPayload(params: EventPayload): boolean {
  return Boolean(params.startDateTime);
}

function buildInsertRequestBody(params: EventPayload): Record<string, unknown> {
  const overrides = buildOverrides(params.reminderMinutes);
  const tz = params.timeZone ?? DEFAULT_TZ;

  if (isTimedPayload(params) && params.startDateTime) {
    const end =
      params.endDateTime ??
      (() => {
        const d = new Date(params.startDateTime!);
        d.setHours(d.getHours() + 1);
        return d.toISOString();
      })();
    return {
      summary: params.summary,
      description: params.description,
      start: { dateTime: params.startDateTime, timeZone: tz },
      end: { dateTime: end, timeZone: tz },
      reminders: { useDefault: false, overrides },
      ...(params.location?.trim() ? { location: params.location.trim() } : {}),
    };
  }
  const day = params.dateIso ?? params.startDateTime?.slice(0, 10) ?? "";
  return {
    summary: params.summary,
    description: params.description,
    start: { date: day },
    end: { date: day },
    reminders: { useDefault: false, overrides },
    ...(params.location?.trim() ? { location: params.location.trim() } : {}),
  };
}

async function insertCalendarEventOnCalendar(
  userEmail: string,
  calendarId: string,
  params: EventPayload
): Promise<string> {
  const auth = getAuthForUser(userEmail);
  const calendar = google.calendar({ version: "v3", auth });
  const requestBody = buildInsertRequestBody(params);
  const res = await calendar.events.insert({
    calendarId,
    requestBody: requestBody as Record<string, unknown>,
  });
  return res.data.id ?? "";
}

async function insertCalendarEventForUser(
  userEmail: string,
  params: EventPayload
): Promise<string> {
  return insertCalendarEventOnCalendar(userEmail, "primary", params);
}

async function deleteCalendarEventForUser(
  userEmail: string,
  eventId: string
): Promise<void> {
  await deleteCalendarEventOnCalendar(userEmail, "primary", eventId);
}

async function deleteCalendarEventOnCalendar(
  userEmail: string,
  calendarId: string,
  eventId: string
): Promise<void> {
  const auth = getAuthForUser(userEmail);
  const calendar = google.calendar({ version: "v3", auth });
  await calendar.events.delete({ calendarId, eventId });
}

function buildPatchBody(params: {
  summary?: string;
  description?: string;
  dateIso?: string;
  startDateTime?: string;
  endDateTime?: string;
  reminderMinutes?: number[];
  location?: string | null;
}): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  if (params.summary !== undefined) body.summary = params.summary;
  if (params.description !== undefined) body.description = params.description;
  if (params.location !== undefined) body.location = params.location || "";
  if (params.startDateTime) {
    const tz = DEFAULT_TZ;
    const end =
      params.endDateTime ??
      (() => {
        const d = new Date(params.startDateTime!);
        d.setHours(d.getHours() + 1);
        return d.toISOString();
      })();
    body.start = { dateTime: params.startDateTime, timeZone: tz };
    body.end = { dateTime: end, timeZone: tz };
  } else if (params.dateIso !== undefined) {
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

async function patchCalendarEventOnCalendar(
  userEmail: string,
  calendarId: string,
  eventId: string,
  patchBody: Record<string, unknown>
): Promise<void> {
  if (Object.keys(patchBody).length === 0) return;
  const auth = getAuthForUser(userEmail);
  const calendar = google.calendar({ version: "v3", auth });
  await calendar.events.patch({
    calendarId,
    eventId,
    requestBody: patchBody,
  });
}

async function patchCalendarEventForUser(
  userEmail: string,
  eventId: string,
  patchBody: Record<string, unknown>
): Promise<void> {
  await patchCalendarEventOnCalendar(userEmail, "primary", eventId, patchBody);
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
  startDateTime?: string | null;
  endDateTime?: string | null;
  location?: string | null;
}): Promise<{ organizerEventId: string; idsByEmail: Record<string, string> }> {
  const defaultUser = getDefaultUser();
  const payload: EventPayload = {
    summary: params.summary,
    description: params.description,
    reminderMinutes: params.reminderMinutes,
    dateIso: params.startDateTime ? undefined : params.dateIso,
    startDateTime: params.startDateTime ?? undefined,
    endDateTime: params.endDateTime ?? undefined,
    location: params.location?.trim() || undefined,
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
  startDateTime?: string;
  endDateTime?: string;
  reminderMinutes?: number[];
  location?: string | null;
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
  startDateTime?: string;
  endDateTime?: string;
  location?: string | null;
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
    reminderMinutes: params.reminderMinutes,
    dateIso: params.startDateTime ? undefined : params.dateIso,
    startDateTime: params.startDateTime,
    endDateTime: params.endDateTime,
    location: params.location?.trim() || undefined,
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

/** Stored fields → map of calendar copies to verify (legacy = organizer id only). */
export function idsByEmailForVerification(
  googleCalendarEventIdsByEmail?: Record<string, string>,
  googleEventId?: string
): Record<string, string> {
  const defaultLower = getDefaultUser().toLowerCase();
  const m: Record<string, string> = {};
  if (googleCalendarEventIdsByEmail) {
    for (const [k, v] of Object.entries(googleCalendarEventIdsByEmail)) {
      m[k.toLowerCase()] = v;
    }
  }
  if (Object.keys(m).length === 0 && googleEventId) {
    m[defaultLower] = googleEventId;
  }
  return m;
}

export type CalendarVerifyCheck = {
  email: string;
  ok: boolean;
  summary?: string;
  startDate?: string;
  error?: string;
};

/** Default firm SOL group calendar (only used when env is unset in non-production). */
const DEV_SOL_MILESTONE_CALENDAR_ID =
  "c_fdf8d70155c50c02fecf733cc8a2aeed08abc04e835166f638bac7db4d37eb1c@group.calendar.google.com";
const DEV_SOL_MILESTONE_IMPERSONATE_EMAIL = "legalassistant@ramosjames.com";

/** Shared firm calendar for SOL lead-up milestones (group calendar id + impersonated user). */
export function getSolMilestoneCalendarConfig(): {
  calendarId: string;
  impersonateEmail: string;
} | null {
  const fromEnvCal = process.env.GOOGLE_SOL_MILESTONE_CALENDAR_ID?.trim();
  const fromEnvImpersonate = process.env.GOOGLE_SOL_MILESTONE_IMPERSONATE_EMAIL?.trim();

  const allowDevFallback = process.env.NODE_ENV !== "production";
  const calendarId =
    fromEnvCal || (allowDevFallback ? DEV_SOL_MILESTONE_CALENDAR_ID : "");
  const impersonateEmail =
    fromEnvImpersonate || (allowDevFallback ? DEV_SOL_MILESTONE_IMPERSONATE_EMAIL : "");

  if (!calendarId || !impersonateEmail) return null;
  return { calendarId, impersonateEmail };
}

export function isConfiguredSolHostCalendarId(calendarId: string | undefined): boolean {
  const cfg = getSolMilestoneCalendarConfig();
  return Boolean(cfg && calendarId && calendarId === cfg.calendarId);
}

export async function insertSolMilestonesOnConfiguredCalendar(params: {
  caseName: string;
  sourceLabel?: string;
  milestones: {
    title: string;
    date: string;
    description: string;
    reminderMinutes: number[];
    /** When set, Google summary is `{stem} - {caseName}` (firm SOL calendar) */
    googleSummaryStem?: string;
  }[];
}): Promise<{ googleEventIds: string[]; hostCalendarId: string }> {
  const cfg = getSolMilestoneCalendarConfig();
  if (!cfg) {
    throw new Error(
      "Set GOOGLE_SOL_MILESTONE_CALENDAR_ID and GOOGLE_SOL_MILESTONE_IMPERSONATE_EMAIL for SOL milestones"
    );
  }
  const caseNameTrim = params.caseName.trim();
  const googleEventIds: string[] = [];
  for (const m of params.milestones) {
    let description = m.description;
    if (params.sourceLabel) {
      description = `Source: ${params.sourceLabel}\n\n${description}`;
    }
    const summary = m.googleSummaryStem?.trim()
      ? `${m.googleSummaryStem.trim()} - ${caseNameTrim}`
      : `${params.caseName} – ${m.title}`;
    const id = await insertCalendarEventOnCalendar(cfg.impersonateEmail, cfg.calendarId, {
      summary,
      description,
      reminderMinutes: m.reminderMinutes,
      dateIso: m.date,
    });
    googleEventIds.push(id);
  }
  return { googleEventIds, hostCalendarId: cfg.calendarId };
}

export async function patchSolMilestoneGoogleEvent(params: {
  claimedHostCalendarId: string | undefined;
  googleEventId: string;
  summary: string;
  description: string;
  dateIso?: string;
  startDateTime?: string;
  endDateTime?: string;
  reminderMinutes?: number[];
  location?: string | null;
}): Promise<void> {
  if (!isConfiguredSolHostCalendarId(params.claimedHostCalendarId)) {
    throw new Error("Invalid host calendar for SOL milestone update");
  }
  const cfg = getSolMilestoneCalendarConfig()!;
  const patchBody = buildPatchBody({
    summary: params.summary,
    description: params.description,
    dateIso: params.dateIso,
    startDateTime: params.startDateTime,
    endDateTime: params.endDateTime,
    reminderMinutes: params.reminderMinutes,
    location: params.location,
  });
  await patchCalendarEventOnCalendar(
    cfg.impersonateEmail,
    cfg.calendarId,
    params.googleEventId,
    patchBody
  );
}

export async function deleteSolMilestoneGoogleEvent(
  googleEventId: string,
  claimedHostCalendarId: string | undefined
): Promise<void> {
  if (!isConfiguredSolHostCalendarId(claimedHostCalendarId)) {
    throw new Error("Invalid host calendar for SOL milestone delete");
  }
  const cfg = getSolMilestoneCalendarConfig()!;
  await deleteCalendarEventOnCalendar(cfg.impersonateEmail, cfg.calendarId, googleEventId);
}

/** Confirm `events.get` succeeds for this user’s primary calendar (DWD impersonation). */
export async function verifyGoogleEventCopy(
  userEmail: string,
  eventId: string,
  expectedDateIso?: string
): Promise<CalendarVerifyCheck> {
  try {
    const auth = getAuthForUser(userEmail);
    const calendar = google.calendar({ version: "v3", auth });
    const res = await calendar.events.get({
      calendarId: "primary",
      eventId,
    });
    const summary = res.data.summary ?? "";
    const startRaw =
      res.data.start?.date ?? res.data.start?.dateTime?.slice(0, 10) ?? undefined;
    const startDate = startRaw?.slice(0, 10);
    let ok = true;
    let error: string | undefined;
    if (expectedDateIso && startDate && startDate !== expectedDateIso.slice(0, 10)) {
      ok = false;
      error = `Date mismatch (Google: ${startDate}, DocketFlow: ${expectedDateIso})`;
    }
    return {
      email: userEmail,
      ok,
      summary,
      startDate,
      error,
    };
  } catch (e) {
    return {
      email: userEmail,
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

/** Verify an event on a specific calendar (e.g. firm SOL group calendar). */
export async function verifyGoogleEventOnCalendar(
  impersonateEmail: string,
  calendarId: string,
  eventId: string,
  expectedDateIso?: string
): Promise<CalendarVerifyCheck> {
  try {
    const auth = getAuthForUser(impersonateEmail);
    const calendar = google.calendar({ version: "v3", auth });
    const res = await calendar.events.get({
      calendarId,
      eventId,
    });
    const summary = res.data.summary ?? "";
    const startRaw =
      res.data.start?.date ?? res.data.start?.dateTime?.slice(0, 10) ?? undefined;
    const startDate = startRaw?.slice(0, 10);
    let ok = true;
    let error: string | undefined;
    if (expectedDateIso && startDate && startDate !== expectedDateIso.slice(0, 10)) {
      ok = false;
      error = `Date mismatch (Google: ${startDate}, DocketFlow: ${expectedDateIso})`;
    }
    return {
      email: `${impersonateEmail} (${calendarId.slice(0, 12)}…)`,
      ok,
      summary,
      startDate,
      error,
    };
  } catch (e) {
    return {
      email: impersonateEmail,
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}
