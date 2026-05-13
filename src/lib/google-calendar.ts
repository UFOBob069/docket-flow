import { google } from "googleapis";
import { addDays, format, parseISO } from "date-fns";
import { normalizeGoogleCalendarInviteColorId } from "@/lib/google-calendar-invite-colors";

const MAX_REMINDER_MIN = 40320;

/** DWD must include this scope for create/update/delete + events.get (verify). */
const SCOPES_CALENDAR_EVENTS = ["https://www.googleapis.com/auth/calendar.events"];

/**
 * Narrow scope for Free/Busy only — add separately in Admin so firms that only delegated
 * `calendar.events` are not forced to add full `calendar.readonly` (which would block JWT
 * token exchange if missing from the delegation list).
 */
const SCOPES_CALENDAR_FREEBUSY = ["https://www.googleapis.com/auth/calendar.freebusy"];

function getJwtForSubject(subject: string, scopes: string[]) {
  const clientEmail = process.env.GOOGLE_CLIENT_EMAIL;
  const privateKey = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n");

  if (!clientEmail || !privateKey) {
    throw new Error("Set GOOGLE_CLIENT_EMAIL and GOOGLE_PRIVATE_KEY for Calendar API");
  }

  return new google.auth.JWT({
    email: clientEmail,
    key: privateKey,
    scopes,
    subject,
  });
}

function getAuthForUser(subject: string) {
  return getJwtForSubject(subject, SCOPES_CALENDAR_EVENTS);
}

function getAuthForFreeBusy(subject: string) {
  return getJwtForSubject(subject, SCOPES_CALENDAR_FREEBUSY);
}

function getDefaultUser(): string {
  const email = process.env.GOOGLE_IMPERSONATE_EMAIL;
  if (!email) {
    throw new Error("Set GOOGLE_IMPERSONATE_EMAIL to a @ramosjames.com user");
  }
  return email;
}

/**
 * User whose primary calendar hosts meeting invites and appears as organizer.
 * Defaults to reminder sender, then the main calendar impersonation user.
 */
export function getMeetingOrganizerEmail(): string {
  const explicit = process.env.GOOGLE_MEETING_ORGANIZER_EMAIL?.trim();
  if (explicit) return explicit;
  const reminder = process.env.GOOGLE_REMINDER_EMAIL?.trim();
  if (reminder) return reminder;
  return getDefaultUser();
}

/** For `events.patch`: omit = leave color; null = clear; string = set if valid. */
function colorIdForGooglePatch(raw: string | null | undefined): string | null | undefined {
  if (raw === undefined) return undefined;
  if (raw === null || String(raw).trim() === "") return null;
  return normalizeGoogleCalendarInviteColorId(String(raw).trim()) ?? undefined;
}

const FREE_BUSY_MAX_ITEMS = 45;
/** Suggest meeting starts only on :00 and :30 (local wall time of `timeMin` / `timeMax`). */
const HALF_HOUR_MS = 30 * 60 * 1000;
const MAX_SLOT_SUGGESTIONS = 12;

/** Smallest timestamp ≥ `fromMs` on a half-hour boundary in the same local timezone as `new Date(fromMs)`. */
function alignUpToHalfHourSlot(fromMs: number): number {
  const d = new Date(fromMs);
  d.setSeconds(0, 0);
  const m = d.getMinutes();
  if (m === 0 || m === 30) {
    return d.getTime();
  }
  if (m < 30) {
    d.setMinutes(30, 0, 0);
  } else {
    d.setHours(d.getHours() + 1, 0, 0, 0);
  }
  return d.getTime();
}

function mergeBusyIntervalsMs(intervals: [number, number][]): [number, number][] {
  if (intervals.length === 0) return [];
  const sorted = [...intervals].sort((a, b) => a[0] - b[0]);
  const out: [number, number][] = [sorted[0]!];
  for (let i = 1; i < sorted.length; i++) {
    const cur = sorted[i]!;
    const last = out[out.length - 1]!;
    if (cur[0] <= last[1]) last[1] = Math.max(last[1], cur[1]);
    else out.push(cur);
  }
  return out;
}

/**
 * FreeBusy across invitees + meeting organizer (impersonated subject = organizer).
 * `timeMin` / `timeMax` must be RFC3339 (e.g. from the same local date+time logic as event creation).
 */
export async function queryMeetingOpenSlotStarts(params: {
  timeMin: string;
  timeMax: string;
  durationMinutes: number;
  attendeeEmails: string[];
}): Promise<{ slotStartIsoCandidates: string[]; calendarWarnings?: string[] }> {
  const organizer = getMeetingOrganizerEmail();
  const orgLower = organizer.toLowerCase();
  const t0 = new Date(params.timeMin).getTime();
  const t1 = new Date(params.timeMax).getTime();
  const durMin = params.durationMinutes;
  if (Number.isNaN(t0) || Number.isNaN(t1) || t0 >= t1) {
    throw new Error("Invalid time window");
  }
  if (!Number.isFinite(durMin) || durMin < 5 || durMin > 24 * 60) {
    throw new Error("Meeting length must be between 5 and 1440 minutes");
  }

  const emails = Array.from(
    new Set(
      [...params.attendeeEmails.map((e) => e.trim().toLowerCase()).filter(Boolean), orgLower]
    )
  ).slice(0, FREE_BUSY_MAX_ITEMS);

  const auth = getAuthForFreeBusy(organizer);
  const calendar = google.calendar({ version: "v3", auth });
  const res = await calendar.freebusy.query({
    requestBody: {
      timeMin: new Date(t0).toISOString(),
      timeMax: new Date(t1).toISOString(),
      items: emails.map((id) => ({ id })),
    },
  });

  type CalEntry = {
    busy?: { start?: string | null; end?: string | null }[];
    errors?: { reason?: string; domain?: string }[];
  };
  const calendars = (res.data.calendars ?? {}) as Record<string, CalEntry>;
  const warnings: string[] = [];
  const busyPieces: [number, number][] = [];

  for (const id of emails) {
    const cal = calendars[id];
    if (!cal) {
      warnings.push(`${id}: no calendar data`);
      busyPieces.push([t0, t1]);
      continue;
    }
    if (cal.errors?.length) {
      warnings.push(
        `${id}: ${cal.errors.map((e) => e.reason ?? e.domain ?? "error").join(", ")}`
      );
      busyPieces.push([t0, t1]);
      continue;
    }
    for (const b of cal.busy ?? []) {
      if (!b.start || !b.end) continue;
      const a = new Date(b.start).getTime();
      const z = new Date(b.end).getTime();
      if (!Number.isNaN(a) && !Number.isNaN(z) && z > a) busyPieces.push([a, z]);
    }
  }

  const merged = mergeBusyIntervalsMs(busyPieces);
  const durMs = durMin * 60 * 1000;
  const slotStartIsoCandidates: string[] = [];

  for (let s = alignUpToHalfHourSlot(t0); s + durMs <= t1; s += HALF_HOUR_MS) {
    const e = s + durMs;
    const clashes = merged.some(([b0, b1]) => b1 > s && b0 < e);
    if (!clashes) {
      slotStartIsoCandidates.push(new Date(s).toISOString());
      if (slotStartIsoCandidates.length >= MAX_SLOT_SUGGESTIONS) break;
    }
  }

  return {
    slotStartIsoCandidates,
    ...(warnings.length ? { calendarWarnings: warnings } : {}),
  };
}

function buildOverrides(minutes: number[]) {
  return minutes
    .filter((m) => m >= 0 && m <= MAX_REMINDER_MIN)
    .slice(0, 5)
    .map((m) => ({ method: "popup" as const, minutes: m }));
}

const DEFAULT_TZ = "America/Chicago";

/** Inclusive last calendar day for all-day Google payload (defaults to start). */
function resolvedAllDayLastInclusive(startYmd: string, deadlineEndYmd?: string | null): string {
  const day = startYmd.trim().slice(0, 10);
  const raw = deadlineEndYmd?.trim().slice(0, 10);
  if (!raw || raw.length !== 10 || raw < day) return day;
  return raw;
}

type EventPayload = {
  summary: string;
  description: string;
  reminderMinutes: number[];
  /** All-day (YYYY-MM-DD) — omit when using timed */
  dateIso?: string;
  /** Inclusive last day for multi-day all-day; omit = single day (`dateIso` only). */
  allDayLastInclusive?: string;
  startDateTime?: string;
  endDateTime?: string;
  /** Zoom / meet link — surfaces prominently in Google Calendar */
  location?: string;
  timeZone?: string;
  /** Google Calendar API event palette id (optional). */
  colorId?: string;
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
      ...(params.colorId ? { colorId: params.colorId } : {}),
    };
  }
  const day = params.dateIso ?? params.startDateTime?.slice(0, 10) ?? "";
  const lastRaw = (params.allDayLastInclusive ?? day).trim() || day;
  const lastInclusive = lastRaw < day ? day : lastRaw;
  const endExclusive = format(addDays(parseISO(lastInclusive), 1), "yyyy-MM-dd");
  return {
    summary: params.summary,
    description: params.description,
    start: { date: day },
    end: { date: endExclusive },
    reminders: { useDefault: false, overrides },
    ...(params.location?.trim() ? { location: params.location.trim() } : {}),
    ...(params.colorId ? { colorId: params.colorId } : {}),
  };
}

async function insertCalendarEventOnCalendar(
  userEmail: string,
  calendarId: string,
  params: EventPayload,
  opts?: { sendUpdates?: "all" | "externalOnly" | "none"; attendeeEmails?: string[] }
): Promise<string> {
  const auth = getAuthForUser(userEmail);
  const calendar = google.calendar({ version: "v3", auth });
  const requestBody: Record<string, unknown> = {
    ...buildInsertRequestBody(params),
  };
  if (opts?.attendeeEmails?.length) {
    requestBody.attendees = opts.attendeeEmails.map((email) => ({ email }));
    requestBody.guestsCanModify = false;
    requestBody.guestsCanInviteOthers = false;
    requestBody.guestsCanSeeOtherGuests = true;
  }
  const res = await calendar.events.insert({
    calendarId,
    ...(opts?.sendUpdates ? { sendUpdates: opts.sendUpdates } : {}),
    requestBody,
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
  eventId: string,
  sendUpdates?: "all" | "externalOnly" | "none"
): Promise<void> {
  await deleteCalendarEventOnCalendar(userEmail, "primary", eventId, sendUpdates);
}

async function deleteCalendarEventOnCalendar(
  userEmail: string,
  calendarId: string,
  eventId: string,
  sendUpdates?: "all" | "externalOnly" | "none"
): Promise<void> {
  const auth = getAuthForUser(userEmail);
  const calendar = google.calendar({ version: "v3", auth });
  await calendar.events.delete({
    calendarId,
    eventId,
    ...(sendUpdates ? { sendUpdates } : {}),
  });
}

function buildPatchBody(params: {
  summary?: string;
  description?: string;
  dateIso?: string;
  allDayLastInclusive?: string;
  startDateTime?: string;
  endDateTime?: string;
  reminderMinutes?: number[];
  location?: string | null;
  /** Omit to leave unchanged; `null` clears to default calendar color. */
  colorId?: string | null;
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
    const day = params.dateIso;
    const lastRaw = (params.allDayLastInclusive ?? day).trim() || day;
    const lastInclusive = lastRaw < day ? day : lastRaw;
    body.start = { date: day };
    body.end = { date: format(addDays(parseISO(lastInclusive), 1), "yyyy-MM-dd") };
  }
  if (params.reminderMinutes?.length) {
    body.reminders = {
      useDefault: false,
      overrides: buildOverrides(params.reminderMinutes),
    };
  }
  if (params.colorId !== undefined) {
    body.colorId = params.colorId;
  }
  return body;
}

async function patchCalendarEventOnCalendar(
  userEmail: string,
  calendarId: string,
  eventId: string,
  patchBody: Record<string, unknown>,
  sendUpdates?: "all" | "externalOnly" | "none"
): Promise<void> {
  if (Object.keys(patchBody).length === 0) return;
  const auth = getAuthForUser(userEmail);
  const calendar = google.calendar({ version: "v3", auth });
  await calendar.events.patch({
    calendarId,
    eventId,
    ...(sendUpdates ? { sendUpdates } : {}),
    requestBody: patchBody,
  });
}

async function patchCalendarEventForUser(
  userEmail: string,
  eventId: string,
  patchBody: Record<string, unknown>,
  sendUpdates?: "all" | "externalOnly" | "none"
): Promise<void> {
  await patchCalendarEventOnCalendar(userEmail, "primary", eventId, patchBody, sendUpdates);
}

/**
 * Deadlines: create the same event on EACH recipient's primary calendar (DWD).
 * Meetings: one timed event on the meeting organizer's calendar with Google attendees + invite emails (`sendUpdates: all`).
 */
export async function insertGoogleEvent(params: {
  summary: string;
  description: string;
  dateIso: string;
  attendeeEmails: string[];
  reminderMinutes: number[];
  startDateTime?: string | null;
  endDateTime?: string | null;
  /** Inclusive last day for multi-day all-day deadlines (ignored when timed). */
  deadlineEndDate?: string | null;
  location?: string | null;
  scheduleKind?: "deadline" | "meeting";
  /** Google Calendar event palette id (optional). */
  googleColorId?: string | null;
}): Promise<{ organizerEventId: string; idsByEmail: Record<string, string> }> {
  const cid = normalizeGoogleCalendarInviteColorId(params.googleColorId ?? undefined);
  const payload: EventPayload = {
    summary: params.summary,
    description: params.description,
    reminderMinutes: params.reminderMinutes,
    dateIso: params.startDateTime ? undefined : params.dateIso,
    startDateTime: params.startDateTime ?? undefined,
    endDateTime: params.endDateTime ?? undefined,
    location: params.location?.trim() || undefined,
    ...(cid ? { colorId: cid } : {}),
    ...(!params.startDateTime
      ? { allDayLastInclusive: resolvedAllDayLastInclusive(params.dateIso, params.deadlineEndDate) }
      : {}),
  };

  if (params.scheduleKind === "meeting") {
    if (!params.startDateTime) {
      throw new Error("Meeting events need a start time to send Google Calendar invites");
    }
    const organizer = getMeetingOrganizerEmail();
    const orgLower = organizer.toLowerCase();
    const guestEmails = Array.from(
      new Set(params.attendeeEmails.map((e) => e.toLowerCase()).filter((e) => e !== orgLower))
    );
    console.log("[calendar] Creating meeting invite as", organizer, "guests:", guestEmails.length);
    const id = await insertCalendarEventOnCalendar(organizer, "primary", payload, {
      sendUpdates: "all",
      attendeeEmails: guestEmails,
    });
    if (!id) throw new Error("Failed to create meeting on organizer calendar");
    return { organizerEventId: id, idsByEmail: { [orgLower]: id } };
  }

  const defaultUser = getDefaultUser();
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
  /** Inclusive last day for multi-day all-day (ignored when timed). */
  deadlineEndDate?: string | null;
  startDateTime?: string;
  endDateTime?: string;
  reminderMinutes?: number[];
  location?: string | null;
  scheduleKind?: "deadline" | "meeting";
  /** Omit = leave color; null = default color; else palette id. */
  googleColorId?: string | null;
}): Promise<void> {
  const patchBody = buildPatchBody({
    summary: params.summary,
    description: params.description,
    dateIso: params.dateIso,
    allDayLastInclusive:
      params.startDateTime || params.dateIso === undefined
        ? undefined
        : resolvedAllDayLastInclusive(params.dateIso, params.deadlineEndDate),
    startDateTime: params.startDateTime,
    endDateTime: params.endDateTime,
    reminderMinutes: params.reminderMinutes,
    location: params.location,
    colorId: colorIdForGooglePatch(params.googleColorId),
  });
  if (Object.keys(patchBody).length === 0) return;

  if (params.scheduleKind === "meeting") {
    const organizer = getMeetingOrganizerEmail();
    const orgLower = organizer.toLowerCase();
    const eventId =
      params.idsByEmail?.[orgLower] ?? params.googleEventId ?? Object.values(params.idsByEmail ?? {})[0];
    if (!eventId) return;
    try {
      await patchCalendarEventForUser(organizer, eventId, patchBody, "all");
    } catch (err) {
      console.warn("[calendar] Patch failed for meeting", err);
    }
    return;
  }

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
  idsByEmail?: Record<string, string>,
  opts?: { scheduleKind?: "deadline" | "meeting" }
): Promise<void> {
  if (opts?.scheduleKind === "meeting") {
    const organizer = getMeetingOrganizerEmail();
    const orgLower = organizer.toLowerCase();
    const eventId = idsByEmail?.[orgLower] ?? googleEventId;
    if (eventId) {
      try {
        await deleteCalendarEventForUser(organizer, eventId, "all");
      } catch (err) {
        console.warn("[calendar] Delete failed for meeting", err);
      }
    }
    return;
  }

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
  /** Inclusive last day for multi-day all-day (ignored when timed). */
  deadlineEndDate?: string | null;
  location?: string | null;
  googleColorId?: string | null;
  /** Prior map (may be partial for legacy events) */
  idsByEmail?: Record<string, string>;
  /** Legacy single id on organizer calendar only */
  googleEventId?: string;
  scheduleKind?: "deadline" | "meeting";
}): Promise<{ idsByEmail: Record<string, string>; organizerEventId: string }> {
  const defaultUser = getDefaultUser();
  const defaultLower = defaultUser.toLowerCase();
  const meetingOrgLower = getMeetingOrganizerEmail().toLowerCase();

  if (params.scheduleKind === "meeting") {
    const oldMeetingMap: Record<string, string> = {};
    if (params.idsByEmail) {
      for (const [k, v] of Object.entries(params.idsByEmail)) {
        oldMeetingMap[k.toLowerCase()] = v;
      }
    }
    const legacyMultiCopy = Object.keys(oldMeetingMap).length > 1;
    const meetingEventId =
      oldMeetingMap[meetingOrgLower] ??
      params.googleEventId ??
      (Object.keys(oldMeetingMap).length === 1 ? Object.values(oldMeetingMap)[0] : undefined);

    if (!legacyMultiCopy && meetingEventId) {
      const guestEmails = Array.from(
        new Set(
          params.attendeeEmails.map((e) => e.toLowerCase()).filter((e) => e !== meetingOrgLower)
        )
      );
      const organizer = getMeetingOrganizerEmail();
      const auth = getAuthForUser(organizer);
      const calendar = google.calendar({ version: "v3", auth });
      await calendar.events.patch({
        calendarId: "primary",
        eventId: meetingEventId,
        sendUpdates: "all",
        requestBody: {
          attendees: guestEmails.map((email) => ({ email })),
        },
      });
      return {
        organizerEventId: meetingEventId,
        idsByEmail: { [meetingOrgLower]: meetingEventId },
      };
    }
  }

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

  const cid = normalizeGoogleCalendarInviteColorId(params.googleColorId ?? undefined);
  const payload: EventPayload = {
    summary: params.summary,
    description: params.description,
    reminderMinutes: params.reminderMinutes,
    dateIso: params.startDateTime ? undefined : params.dateIso,
    startDateTime: params.startDateTime,
    endDateTime: params.endDateTime,
    location: params.location?.trim() || undefined,
    ...(cid ? { colorId: cid } : {}),
    ...(!params.startDateTime
      ? { allDayLastInclusive: resolvedAllDayLastInclusive(params.dateIso, params.deadlineEndDate) }
      : {}),
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
