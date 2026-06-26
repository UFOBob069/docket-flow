import { buildCalendarBatches, hasGoogleCalendarSync } from "@/lib/calendar-payload";
import { postCalendarSync } from "@/lib/calendar-client";
import { isGoogleIcsMirrorEvent } from "@/lib/calendar-event-origin";
import { caseDisplayName } from "@/lib/case-display";
import { deadlineInclusiveEndDate } from "@/lib/event-date-range";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchEventsForCase, logActivity, saveEvent } from "@/lib/supabase/repo";
import type { CalendarEvent, Case, Contact } from "@/lib/types";

export const CALENDAR_MISSING_SYNC_ALLOWED_EMAIL = "david@ramosjames.com";

export function canAccessCalendarMissingSync(email: string | null | undefined): boolean {
  return email?.trim().toLowerCase() === CALENDAR_MISSING_SYNC_ALLOWED_EMAIL;
}

export const CALENDAR_GAP_SYNC_CHUNK = 5;

export type UnsyncedEventRow = {
  case: Case;
  event: CalendarEvent;
  canCreate: boolean;
  blockReason: string | null;
};

export function attendeeEmailsForCase(caseRecord: Case, contacts: Contact[]): string[] {
  const assigned = caseRecord.assignedContactIds ?? [];
  return Array.from(
    new Set(
      assigned
        .map((id) => contacts.find((c) => c.id === id)?.email)
        .filter((e): e is string => Boolean(e?.trim()))
    )
  );
}

export function isBackfillNonSyncEvent(ev: Pick<CalendarEvent, "description">): boolean {
  return (ev.description ?? "").toLowerCase().includes("backfill");
}

export function eligibilityForGoogleCreate(
  _caseRecord: Case,
  ev: CalendarEvent
): { canCreate: boolean; blockReason: string | null } {
  if (hasGoogleCalendarSync(ev)) {
    return { canCreate: false, blockReason: "Already has Google Calendar linkage" };
  }
  if (isBackfillNonSyncEvent(ev)) {
    return { canCreate: false, blockReason: "Backfill in description (no Google invite needed)" };
  }
  if (isGoogleIcsMirrorEvent(ev)) {
    return { canCreate: false, blockReason: "Originally from Google (local mirror only)" };
  }
  if (!ev.included) {
    return { canCreate: false, blockReason: "Excluded from calendar import" };
  }
  if (ev.completed) {
    return { canCreate: false, blockReason: "Marked complete" };
  }
  return { canCreate: true, blockReason: null };
}

/** Events in DocketFlow with no stored Google Calendar ids (includes blocked rows). */
export function listUnsyncedEvents(
  bundled: { case: Case; events: CalendarEvent[] }[],
  options?: { forwardOnly?: boolean; todayYmd?: string }
): UnsyncedEventRow[] {
  const today = options?.todayYmd ?? new Date().toISOString().slice(0, 10);
  const forwardOnly = options?.forwardOnly !== false;
  const rows: UnsyncedEventRow[] = [];
  for (const { case: c, events } of bundled) {
    for (const event of events) {
      if (hasGoogleCalendarSync(event)) continue;
      if (forwardOnly && deadlineInclusiveEndDate(event) < today) continue;
      const { canCreate, blockReason } = eligibilityForGoogleCreate(c, event);
      rows.push({ case: c, event, canCreate, blockReason });
    }
  }
  rows.sort((a, b) => {
    const d = a.event.date.localeCompare(b.event.date);
    if (d !== 0) return d;
    return caseDisplayName(a.case).localeCompare(caseDisplayName(b.case));
  });
  return rows;
}

export function rowKey(caseId: string, eventId: string): string {
  return `${caseId}:${eventId}`;
}

export type GapSyncProgress = {
  phase: string;
  current: number;
  total: number;
};

export type ImportSyncLogStatus = "pending" | "syncing" | "synced" | "skipped" | "failed";

export type ImportSyncLogEntry = {
  eventId: string;
  title: string;
  date: string;
  status: ImportSyncLogStatus;
  detail?: string;
};

export type SyncGoogleInvitesSequentialResult = {
  linked: number;
  skipped: number;
  error?: string;
  failedEventId?: string;
};

/** Create Google invites one event at a time; persist each row to Supabase before the next. */
export async function syncGoogleInvitesSequential(
  supabase: SupabaseClient,
  params: {
    caseRecord: Case;
    /** Rows already saved to case_events (included deadlines eligible for calendar). */
    events: CalendarEvent[];
    attendeeEmails: string[];
    sourceLabel: string;
    idToken: string;
    onLogUpdate: (entries: ImportSyncLogEntry[]) => void;
  }
): Promise<SyncGoogleInvitesSequentialResult> {
  const { caseRecord, events, attendeeEmails, sourceLabel, idToken, onLogUpdate } = params;
  const caseId = caseRecord.id;
  const displayName = caseDisplayName(caseRecord);

  const entries: ImportSyncLogEntry[] = events.map((ev) => {
    const { canCreate, blockReason } = eligibilityForGoogleCreate(caseRecord, ev);
    if (!canCreate) {
      return {
        eventId: ev.id,
        title: ev.title,
        date: ev.date,
        status: "skipped" as const,
        detail: blockReason ?? "No Google invite",
      };
    }
    return {
      eventId: ev.id,
      title: ev.title,
      date: ev.date,
      status: "pending" as const,
    };
  });
  onLogUpdate([...entries]);

  let linked = 0;
  let skipped = entries.filter((e) => e.status === "skipped").length;

  const pendingIds = entries.filter((e) => e.status === "pending").map((e) => e.eventId);

  for (let i = 0; i < pendingIds.length; i++) {
    const eventId = pendingIds[i]!;
    const idx = entries.findIndex((e) => e.eventId === eventId);
    if (idx < 0) continue;

    const fresh = await fetchEventsForCase(supabase, caseId);
    const latest = fresh.find((e) => e.id === eventId);
    if (!latest) {
      entries[idx] = {
        ...entries[idx]!,
        status: "failed",
        detail: "Event not found in database",
      };
      onLogUpdate([...entries]);
      return { linked, skipped, error: "Event not found in database", failedEventId: eventId };
    }

    if (hasGoogleCalendarSync(latest)) {
      entries[idx] = { ...entries[idx]!, status: "skipped", detail: "Already synced" };
      skipped++;
      onLogUpdate([...entries]);
      continue;
    }

    const { canCreate, blockReason } = eligibilityForGoogleCreate(caseRecord, latest);
    if (!canCreate) {
      entries[idx] = {
        ...entries[idx]!,
        status: "skipped",
        detail: blockReason ?? "No Google invite",
      };
      skipped++;
      onLogUpdate([...entries]);
      continue;
    }

    const batches = buildCalendarBatches([latest]);
    const b = batches[0];
    if (!b) {
      entries[idx] = { ...entries[idx]!, status: "skipped", detail: "Cannot build calendar payload" };
      skipped++;
      onLogUpdate([...entries]);
      continue;
    }

    entries[idx] = { ...entries[idx]!, status: "syncing", detail: `Creating invite ${i + 1} of ${pendingIds.length}…` };
    onLogUpdate([...entries]);

    try {
      const res = await postCalendarSync(
        {
          action: "create",
          caseName: displayName,
          sourceLabel,
          events: [
            {
              title: b.title,
              date: b.date,
              description: b.description,
              reminderMinutes: b.reminderMinutes,
              ...(b.scheduleKind ? { scheduleKind: b.scheduleKind } : {}),
              ...(b.startDateTime ? { startDateTime: b.startDateTime } : {}),
              ...(b.endDateTime ? { endDateTime: b.endDateTime } : {}),
              ...(b.location ? { location: b.location } : {}),
              ...(typeof b.googleColorId !== "undefined" ? { googleColorId: b.googleColorId } : {}),
              ...(typeof b.deadlineEndDate !== "undefined" ? { deadlineEndDate: b.deadlineEndDate } : {}),
            },
          ],
          attendeeEmails,
        },
        idToken
      );
      const calJson = (await res.json()) as {
        googleEventIds?: string[];
        googleEventIdMaps?: Record<string, string>[];
        error?: string;
      };
      if (!res.ok) throw new Error(calJson.error ?? "Google Calendar create failed");

      const ge = calJson.googleEventIds?.[0];
      const map = calJson.googleEventIdMaps?.[0];
      if (!ge) throw new Error("Google Calendar did not return an event id");

      const updated: CalendarEvent = {
        ...latest,
        googleEventId: ge,
        ...(map && Object.keys(map).length ? { googleCalendarEventIdsByEmail: map } : {}),
      };
      await saveEvent(supabase, caseId, updated);

      entries[idx] = {
        ...entries[idx]!,
        status: "synced",
        detail: "Saved to DocketFlow and Google Calendar",
      };
      linked++;
      onLogUpdate([...entries]);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Google Calendar create failed";
      entries[idx] = { ...entries[idx]!, status: "failed", detail: message };
      onLogUpdate([...entries]);
      return { linked, skipped, error: message, failedEventId: eventId };
    }
  }

  return { linked, skipped };
}

export async function createGoogleInvitesForCase(
  supabase: SupabaseClient,
  params: {
    caseRecord: Case;
    events: CalendarEvent[];
    contacts: Contact[];
    idToken: string;
    userId: string;
    userEmail: string;
    onProgress?: (p: GapSyncProgress) => void;
  }
): Promise<number> {
  const { caseRecord, events, contacts, idToken, userId, userEmail, onProgress } = params;
  const caseId = caseRecord.id;
  const fresh = await fetchEventsForCase(supabase, caseId);
  const freshById = new Map(fresh.map((e) => [e.id, e]));

  const toCreate: CalendarEvent[] = [];
  for (const ev of events) {
    const latest = freshById.get(ev.id);
    if (!latest) continue;
    const { canCreate } = eligibilityForGoogleCreate(caseRecord, latest);
    if (!canCreate) continue;
    toCreate.push(latest);
  }

  const batches = buildCalendarBatches(toCreate);
  if (batches.length === 0) return 0;

  const attendeeEmails = attendeeEmailsForCase(caseRecord, contacts);
  const displayName = caseDisplayName(caseRecord);
  let linked = 0;
  let withGoogle = fresh.map((e) => ({ ...e }));

  for (let chunkStart = 0; chunkStart < batches.length; chunkStart += CALENDAR_GAP_SYNC_CHUNK) {
    const chunk = batches.slice(chunkStart, chunkStart + CALENDAR_GAP_SYNC_CHUNK);
    onProgress?.({
      phase: `${displayName}: creating ${chunkStart + 1}–${chunkStart + chunk.length} of ${batches.length}`,
      current: chunkStart,
      total: batches.length,
    });

    const res = await postCalendarSync(
      {
        action: "create",
        caseName: displayName,
        sourceLabel: "DocketFlow — missing sync",
        events: chunk.map((b) => ({
          title: b.title,
          date: b.date,
          description: b.description,
          reminderMinutes: b.reminderMinutes,
          ...(b.scheduleKind ? { scheduleKind: b.scheduleKind } : {}),
          ...(b.startDateTime ? { startDateTime: b.startDateTime } : {}),
          ...(b.endDateTime ? { endDateTime: b.endDateTime } : {}),
          ...(b.location ? { location: b.location } : {}),
          ...(typeof b.googleColorId !== "undefined" ? { googleColorId: b.googleColorId } : {}),
          ...(typeof b.deadlineEndDate !== "undefined" ? { deadlineEndDate: b.deadlineEndDate } : {}),
        })),
        attendeeEmails,
      },
      idToken
    );
    const calJson = (await res.json()) as {
      googleEventIds?: string[];
      googleEventIdMaps?: Record<string, string>[];
      error?: string;
    };
    if (!res.ok) throw new Error(calJson.error ?? "Google Calendar create failed");

    const googleEventIds = calJson.googleEventIds ?? [];
    const googleEventIdMaps = calJson.googleEventIdMaps ?? [];
    for (let j = 0; j < chunk.length; j++) {
      const ge = googleEventIds[j];
      const map = googleEventIdMaps[j];
      if (!ge) continue;
      const batchIndex = chunkStart + j;
      for (const eid of batches[batchIndex]!.sourceEventIds) {
        withGoogle = withGoogle.map((ev) =>
          ev.id === eid
            ? {
                ...ev,
                googleEventId: ge,
                ...(map && Object.keys(map).length ? { googleCalendarEventIdsByEmail: map } : {}),
              }
            : ev
        );
      }
    }

    const chunkEids = new Set(chunk.flatMap((b) => b.sourceEventIds));
    const toSave = withGoogle.filter((ev) => chunkEids.has(ev.id) && hasGoogleCalendarSync(ev));
    await Promise.all(toSave.map((ev) => saveEvent(supabase, caseId, ev)));
    linked += toSave.length;
  }

  if (linked > 0) {
    await logActivity(supabase, userId, {
      caseId,
      caseName: displayName,
      action: "event_created",
      description: `Created Google Calendar invites for ${linked} deadline(s) missing sync`,
      userEmail,
    });
  }

  return linked;
}
