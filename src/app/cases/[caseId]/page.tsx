"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { differenceInCalendarDays, format, parseISO } from "date-fns";
import { useParams, useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { getBrowserSupabase } from "@/lib/supabase/singleton";
import { caseDisplayName } from "@/lib/case-display";
import { isPreferredLanguage, PREFERRED_LANGUAGE_OPTIONS } from "@/lib/preferred-languages";
import {
  buildCaseAssignedContactIds,
  caseCalendarInviteContactIds,
  caseContactDisplayLabel,
  caseContactSlotsFromCase,
  contactByIdMap,
} from "@/lib/case-attorneys";
import { slackChannelLabel, slackChannelUrl } from "@/lib/slack-channel";
import { buildCalendarBatches, googleCalendarDescription, hasGoogleCalendarSync } from "@/lib/calendar-payload";
import { isBackfillNonSyncEvent } from "@/lib/calendar-gap-sync";
import { attendeeEmailsForEvent, canManageEventAttendees, contactNamesForIds } from "@/lib/event-attendees";
import { postCalendarSync } from "@/lib/calendar-client";
import { CALENDAR_TIMEZONE, defaultEndIso } from "@/lib/event-factory";
import {
  deadlineInclusiveEndDate,
  eachYmdInInclusiveRange,
  eventIntersectsMonth,
  shiftCalendarDays,
} from "@/lib/event-date-range";
import { isGoogleIcsMirrorEvent } from "@/lib/calendar-event-origin";
import { getFixedRemindersForKind, isTaxonomyEventKind } from "@/lib/case-event-kinds";
import {
  ALL_EVENT_KIND_SELECT_GROUPS,
  EVENT_KIND_LABELS,
  augmentKindGroupsForEdit,
  categoryForManualEventKind,
} from "@/lib/one-off-events";
import {
  bulkDeleteEvents,
  bulkRescheduleEvents,
  clearEventGoogleCalendarFields,
  deleteCaseCascade,
  deleteEvent,
  fetchEventsForCase,
  fetchSlackChannelForCase,
  logActivity,
  saveEvent,
  subscribeCase,
  subscribeContacts,
  subscribeEvents,
  updateCase,
} from "@/lib/supabase/repo";
import type {
  CalendarEvent,
  Case,
  CaseSlackChannel,
  CaseStatus,
  Contact,
  EventCategory,
  EventKind,
  EventScheduleKind,
} from "@/lib/types";
import { AddCalendarEventModal } from "@/components/AddCalendarEventModal";
import { EventAttendeesModal } from "@/components/EventAttendeesModal";
import {
  FederalHolidayBlockedNotice,
  FederalHolidayDateInput,
} from "@/components/FederalHolidayDateInput";
import { useFederalHolidays } from "@/hooks/useFederalHolidays";
import { validateEventScheduleAgainstFederalHolidays } from "@/lib/federal-holidays";
import type { MonthlyCalendarEventChip } from "@/components/MonthlyEventCalendar";
import { FixedRemindersReadout } from "@/components/FixedRemindersReadout";
import { MonthlyEventCalendar } from "@/components/MonthlyEventCalendar";
import { PageSkeleton } from "@/components/PageSkeleton";
import { GoogleCalendarInviteColorPicker } from "@/components/GoogleCalendarInviteColorPicker";
import { ReminderMinutesEditor } from "@/components/ReminderMinutesEditor";
import { FiveMinuteTimeSelect } from "@/components/FiveMinuteTimeSelect";
import {
  isEndTimeAfterStartTime,
  isoToLocalDateTimeParts,
  localDateTimePartsToIso,
} from "@/lib/five-minute-datetime";
import { compareEventsBySchedule } from "@/lib/event-schedule";
import { useHydrated } from "@/hooks/useHydrated";
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  Input,
  Label,
  PageWrapper,
  Select,
  Textarea,
} from "@/components/ui";

const catBadge: Record<EventCategory, "trial" | "discovery" | "motions" | "pretrial" | "mediation" | "experts" | "other"> = {
  trial: "trial", discovery: "discovery", motions: "motions",
  pretrial: "pretrial", mediation: "mediation", experts: "experts", other: "other",
};

const EVENT_DT_FORMAT: Intl.DateTimeFormatOptions = {
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZone: CALENDAR_TIMEZONE,
};

function formatEventAt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, EVENT_DT_FORMAT);
}

function eventCreatorLine(
  ev: CalendarEvent,
  viewerId?: string | null,
  viewerEmail?: string | null
): string {
  const stored = ev.createdByEmail?.trim();
  if (stored) return `Created by ${stored}`;
  if (viewerId && ev.ownerId === viewerId) {
    const e = viewerEmail?.trim();
    return e ? `Created by ${e}` : "Created by you";
  }
  return "Created by another team member";
}

function todayYmd(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Prior calendar day of span end, not marked complete. */
function isCalendarEventOverdue(ev: CalendarEvent): boolean {
  if (ev.completed) return false;
  const last = deadlineInclusiveEndDate(ev);
  return differenceInCalendarDays(parseISO(last), parseISO(todayYmd())) < 0;
}

/** Delete body for `/api/calendar/sync` — SOL host rows use `googleHostCalendarId` instead of per-user copies */
function calendarDeletePayload(ev: CalendarEvent): {
  action: "delete";
  googleEventId: string;
  googleHostCalendarId?: string;
  googleCalendarEventIdsByEmail?: Record<string, string>;
  scheduleKind?: "deadline" | "meeting";
} {
  const base = {
    action: "delete" as const,
    googleEventId: ev.googleEventId!,
    ...(ev.scheduleKind === "meeting" ? { scheduleKind: "meeting" as const } : {}),
  };
  if (ev.googleHostCalendarId) {
    return { ...base, googleHostCalendarId: ev.googleHostCalendarId };
  }
  if (
    ev.googleCalendarEventIdsByEmail &&
    Object.keys(ev.googleCalendarEventIdsByEmail).length > 0
  ) {
    return { ...base, googleCalendarEventIdsByEmail: ev.googleCalendarEventIdsByEmail };
  }
  return base;
}

/** Taxonomy kinds always use the fixed reminder list (repair stale DB rows on edit). */
function calendarEventForEdit(e: CalendarEvent): CalendarEvent {
  const k = e.eventKind ?? "other_event";
  if (isTaxonomyEventKind(k)) {
    return { ...e, remindersMinutes: [...getFixedRemindersForKind(k)] };
  }
  return e;
}

function shortDeadlineTitle(title: string, max = 56): string {
  const t = title.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, Math.max(0, max - 1))}…`;
}

/** True when we should strip Google linkage from the DB row (non-ICS events only). */
function eventNeedsGoogleCalendarClear(ev: CalendarEvent): boolean {
  if (isGoogleIcsMirrorEvent(ev)) return false;
  return Boolean(
    ev.googleEventId ||
      ev.googleHostCalendarId ||
      (ev.googleCalendarEventIdsByEmail &&
        Object.keys(ev.googleCalendarEventIdsByEmail).length > 0)
  );
}

/** One step per Google delete + clear, plus finalize (updateCase + activity). */
function archiveProgressTotalSteps(events: CalendarEvent[]): number {
  let n = 0;
  for (const ev of events) {
    if (isGoogleIcsMirrorEvent(ev)) continue;
    if (ev.googleEventId) n++;
    if (eventNeedsGoogleCalendarClear(ev)) n++;
  }
  return n + 2;
}

function permanentDeleteProgressTotalSteps(events: CalendarEvent[]): number {
  const n = events.filter((e) => !isGoogleIcsMirrorEvent(e) && e.googleEventId).length;
  return n + 2;
}

type CaseOperationProgress = {
  headline: string;
  phase: string;
  current: number;
  total: number;
};

type VerifyResponse = {
  checkedAt: string;
  summary: { totalChecks: number; ok: number; failed: number };
  events: {
    title: string;
    date: string;
    checks: { email: string; ok: boolean; summary?: string; startDate?: string; error?: string }[];
  }[];
};

export default function CaseDetailPage() {
  const params = useParams();
  const caseId = params.caseId as string;
  const router = useRouter();
  const hydrated = useHydrated();
  const { user, loading, idToken, supabaseReady } = useAuth();
  const [c, setC] = useState<Case | null | undefined>(undefined);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [editing, setEditing] = useState<CalendarEvent | null>(null);
  const [busy, setBusy] = useState(false);
  const [caseOpProgress, setCaseOpProgress] = useState<CaseOperationProgress | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Bulk selection
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showBulkReschedule, setShowBulkReschedule] = useState(false);
  const [shiftDays, setShiftDays] = useState("");

  // Reassign
  const [showReassign, setShowReassign] = useState(false);
  const [reassignMainAttorneyId, setReassignMainAttorneyId] = useState("");
  const [reassignEventAttorneyId, setReassignEventAttorneyId] = useState("");
  const [reassignParalegalId, setReassignParalegalId] = useState("");
  const [reassignExtraIds, setReassignExtraIds] = useState<string[]>([]);
  const [editPreferredLanguage, setEditPreferredLanguage] = useState("");

  const [verifyBusy, setVerifyBusy] = useState(false);
  const [verifyResult, setVerifyResult] = useState<VerifyResponse | null>(null);
  const [creatingGoogleInviteId, setCreatingGoogleInviteId] = useState<string | null>(null);
  const [addingPeopleTo, setAddingPeopleTo] = useState<CalendarEvent | null>(null);
  const [slackChannel, setSlackChannel] = useState<CaseSlackChannel | null>(null);
  const [editHolidayDateMsg, setEditHolidayDateMsg] = useState<string | null>(null);
  const [editHolidayEndMsg, setEditHolidayEndMsg] = useState<string | null>(null);
  const { holidays } = useFederalHolidays();

  const [showAddEvent, setShowAddEvent] = useState(false);
  const [eventViewMode, setEventViewMode] = useState<"timeline" | "month">("timeline");
  const [monthCursor, setMonthCursor] = useState(() => format(new Date(), "yyyy-MM"));

  const eventIdsInMonth = useMemo(
    () => [...new Set(events.filter((e) => eventIntersectsMonth(e, monthCursor)).map((e) => e.id))],
    [events, monthCursor]
  );
  const allInMonthSelected =
    eventIdsInMonth.length > 0 && eventIdsInMonth.every((id) => selected.has(id));

  const contactById = useMemo(() => contactByIdMap(contacts), [contacts]);
  const attorneys = useMemo(
    () => contacts.filter((ct) => ct.role === "attorney").sort((a, b) => a.name.localeCompare(b.name)),
    [contacts]
  );
  const paralegals = useMemo(
    () => contacts.filter((ct) => ct.role === "paralegal").sort((a, b) => a.name.localeCompare(b.name)),
    [contacts]
  );

  const eventKindSelectGroups = useMemo(
    () => augmentKindGroupsForEdit(ALL_EVENT_KIND_SELECT_GROUPS, editing?.eventKind),
    [editing?.eventKind]
  );

  const sortedEvents = useMemo(
    () => [...events].sort(compareEventsBySchedule),
    [events]
  );

  useEffect(() => {
    if (!supabaseReady || loading || !user || !caseId) return;
    const supabase = getBrowserSupabase();
    const u1 = subscribeCase(supabase, caseId, setC);
    const u2 = subscribeEvents(supabase, caseId, setEvents);
    const u3 = subscribeContacts(supabase, user.id, setContacts);
    return () => { u1(); u2(); u3(); };
  }, [user, loading, supabaseReady, caseId]);

  useEffect(() => {
    if (!loading && supabaseReady && !user) router.replace("/login");
  }, [user, loading, supabaseReady, router]);

  useEffect(() => {
    if (c) setEditPreferredLanguage(c.preferredLanguage ?? "");
  }, [c?.id, c?.preferredLanguage]);

  useEffect(() => {
    if (!supabaseReady || !user || !c) {
      setSlackChannel(null);
      return;
    }
    const num = c.caseNumber?.trim() || c.causeNumber?.trim();
    if (!num) {
      setSlackChannel(null);
      return;
    }
    let cancelled = false;
    const supabase = getBrowserSupabase();
    void fetchSlackChannelForCase(supabase, c)
      .then((row) => {
        if (!cancelled) setSlackChannel(row);
      })
      .catch((e) => {
        console.warn("[case slack lookup]", e);
        if (!cancelled) setSlackChannel(null);
      });
    return () => {
      cancelled = true;
    };
  }, [c, user, supabaseReady]);

  /** Start/end times on the event date while “Edit event” is open (date is the single field above). */
  const [pickStartTime, setPickStartTime] = useState("");
  const [pickEndTime, setPickEndTime] = useState("");
  const lastEditId = useRef<string | null>(null);

  useEffect(() => {
    if (!editing) {
      lastEditId.current = null;
      return;
    }
    if (lastEditId.current === editing.id) return;
    lastEditId.current = editing.id;
    setEditHolidayDateMsg(null);
    setEditHolidayEndMsg(null);
    setPickStartTime(
      editing.startDateTime ? isoToLocalDateTimeParts(editing.startDateTime).time : ""
    );
    setPickEndTime(editing.endDateTime ? isoToLocalDateTimeParts(editing.endDateTime).time : "");
  }, [editing]);

  function flash(message: string) {
    setSuccessMsg(message);
    setTimeout(() => setSuccessMsg(null), 3000);
  }

  async function runCalendarVerify() {
    if (!idToken) return;
    const toVerify = events.filter(
      (e) =>
        !isGoogleIcsMirrorEvent(e) &&
        (e.googleEventId ||
          (e.googleCalendarEventIdsByEmail &&
            Object.keys(e.googleCalendarEventIdsByEmail).length > 0))
    );
    if (toVerify.length === 0) {
      setMsg("No synced deadlines to verify.");
      return;
    }
    setVerifyBusy(true);
    setMsg(null);
    setVerifyResult(null);
    try {
      const res = await fetch("/api/calendar/verify", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          events: toVerify.map((e) => ({
            title: e.title,
            date: e.date,
            googleEventId: e.googleEventId,
            googleCalendarEventIdsByEmail: e.googleCalendarEventIdsByEmail,
            ...(e.googleHostCalendarId ? { googleHostCalendarId: e.googleHostCalendarId } : {}),
          })),
        }),
      });
      const data = (await res.json()) as VerifyResponse & { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Verification failed");
      setVerifyResult(data);
      if (data.summary.failed === 0) {
        flash(
          `Google Calendar OK — ${data.summary.ok} copy${data.summary.ok !== 1 ? "ies" : ""} verified`
        );
      }
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Verification failed");
    } finally {
      setVerifyBusy(false);
    }
  }

  async function createGoogleInviteForEvent(sourceEv: CalendarEvent) {
    if (!caseId || !c || c.status !== "active" || !user || !idToken) return;
    if (creatingGoogleInviteId) return;
    if (isGoogleIcsMirrorEvent(sourceEv) || sourceEv.completed || !sourceEv.included) return;
    if (isBackfillNonSyncEvent(sourceEv)) return;

    setCreatingGoogleInviteId(sourceEv.id);
    setMsg(null);
    try {
      const supabase = getBrowserSupabase();
      const fresh = await fetchEventsForCase(supabase, caseId);
      const latest = fresh.find((e) => e.id === sourceEv.id);
      if (!latest) throw new Error("Event not found on this case.");
      if (isGoogleIcsMirrorEvent(latest)) return;
      if (latest.completed || !latest.included) {
        setMsg("This deadline is completed or excluded; it cannot get a new Google invite.");
        return;
      }
      if (hasGoogleCalendarSync(latest)) {
        flash("This deadline already has a Google Calendar invite.");
        return;
      }
      const batches = buildCalendarBatches([latest]);
      if (batches.length === 0) {
        setMsg("This event cannot be synced (check included / completed state).");
        return;
      }
      const b = batches[0];
      const attendeeEmails = attendeeEmailsForEvent(c, latest, contacts);
      const displayName = caseDisplayName(c);
      const res = await postCalendarSync(
        {
          action: "create",
          caseName: displayName,
          sourceLabel: "DocketFlow",
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
      if (!ge) throw new Error("Google Calendar did not return an event id.");
      const updated: CalendarEvent = {
        ...latest,
        googleEventId: ge,
        ...(map && Object.keys(map).length ? { googleCalendarEventIdsByEmail: map } : {}),
      };
      await saveEvent(supabase, caseId, updated);
      await logActivity(supabase, user.id, {
        caseId,
        caseName: displayName,
        action: "event_created",
        description: `Created Google Calendar invite for "${latest.title}" (${latest.date})`,
        userEmail: user.email ?? "",
      });
      flash(`Google invite created for "${latest.title}"`);
      setEditing((prev) =>
        prev?.id === latest.id
          ? {
              ...prev,
              googleEventId: ge,
              ...(map && Object.keys(map).length ? { googleCalendarEventIdsByEmail: map } : {}),
            }
          : prev
      );
    } catch (e) {
      let message = e instanceof Error ? e.message : "Could not create Google invite";
      if (message === "Failed to fetch") {
        message =
          "Network error or timeout. Refresh in a moment—the invite may still have been created.";
      }
      setMsg(message);
    } finally {
      setCreatingGoogleInviteId(null);
    }
  }

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    if (eventViewMode === "month") {
      if (eventIdsInMonth.length === 0) return;
      if (allInMonthSelected) {
        setSelected((prev) => {
          const next = new Set(prev);
          for (const id of eventIdsInMonth) next.delete(id);
          return next;
        });
      } else {
        setSelected((prev) => {
          const next = new Set(prev);
          for (const id of eventIdsInMonth) next.add(id);
          return next;
        });
      }
      return;
    }
    if (selected.size === events.length) setSelected(new Set());
    else setSelected(new Set(events.map((e) => e.id)));
  }

  const caseMonthChips = useMemo(() => {
    const chips: MonthlyCalendarEventChip[] = [];
    for (const ev of events) {
      if (!eventIntersectsMonth(ev, monthCursor)) continue;
      const overdue = isCalendarEventOverdue(ev);
      if (ev.startDateTime) {
        if (ev.date.length >= 7 && ev.date.slice(0, 7) === monthCursor) {
          chips.push({
            id: ev.id,
            date: ev.date,
            title: ev.title,
            selectable: true as const,
            selected: selected.has(ev.id),
            onToggleSelect: () => toggleSelect(ev.id),
            onOpen: () => setEditing(calendarEventForEdit(ev)),
            dimmed: ev.noiseFlag,
            completed: ev.completed,
            overdue,
          });
        }
        continue;
      }
      const endInc = deadlineInclusiveEndDate(ev);
      for (const yd of eachYmdInInclusiveRange(ev.date, endInc)) {
        if (yd.slice(0, 7) !== monthCursor) continue;
        chips.push({
          id: ev.id,
          date: yd,
          title: ev.title,
          selectable: true as const,
          selected: selected.has(ev.id),
          onToggleSelect: () => toggleSelect(ev.id),
          onOpen: () => setEditing(calendarEventForEdit(ev)),
          dimmed: ev.noiseFlag,
          completed: ev.completed,
          overdue,
        });
      }
    }
    return chips;
  }, [events, monthCursor, selected]);

  async function setStatus(status: CaseStatus) {
    if (!caseId || !c || !user) return;
    const supabase = getBrowserSupabase();
    const display = caseDisplayName(c);

    if (status === "archived") {
      if (
        !confirm(
          "Archive this case? All events will be removed from Google Calendar. Deadlines stay in DocketFlow as a full history."
        )
      ) {
        return;
      }
      setBusy(true);
      setMsg(null);
      const totalSteps = archiveProgressTotalSteps(events);
      let completed = 0;
      const pulse = (phase: string) => {
        setCaseOpProgress({
          headline: "Archiving case",
          phase,
          current: completed,
          total: totalSteps,
        });
      };
      pulse("Starting…");
      try {
        let removed = 0;
        for (const ev of events) {
          if (!isGoogleIcsMirrorEvent(ev) && ev.googleEventId) {
            pulse(`Removing “${shortDeadlineTitle(ev.title)}” from Google Calendar…`);
            const res = await postCalendarSync(calendarDeletePayload(ev), idToken);
            if (!res.ok) {
              const j = (await res.json()) as { error?: string };
              throw new Error(j.error ?? "Calendar delete failed");
            }
            removed++;
            completed++;
            setCaseOpProgress((p) => (p ? { ...p, current: completed } : null));
          }
          if (eventNeedsGoogleCalendarClear(ev)) {
            pulse(`Clearing Google linkage for “${shortDeadlineTitle(ev.title)}” in DocketFlow…`);
            await clearEventGoogleCalendarFields(supabase, caseId, ev.id);
            completed++;
            setCaseOpProgress((p) => (p ? { ...p, current: completed } : null));
          }
        }
        pulse("Marking case as archived…");
        await updateCase(supabase, caseId, { status });
        completed++;
        setCaseOpProgress((p) => (p ? { ...p, current: completed } : null));

        pulse("Recording activity…");
        await logActivity(supabase, user.id, {
          caseId,
          caseName: display,
          action: "case_archived",
          description: `Archived case — removed ${removed} event(s) from Google Calendar`,
          userEmail: user.email ?? "",
        });
        completed++;
        setCaseOpProgress((p) => (p ? { ...p, current: completed } : null));

        flash("Case archived — Google Calendar copies removed");
      } catch (e) {
        setMsg(e instanceof Error ? e.message : "Archive failed");
      } finally {
        setCaseOpProgress(null);
        setBusy(false);
      }
      return;
    }

    setBusy(true);
    setMsg(null);
    try {
      await updateCase(supabase, caseId, { status });
      await logActivity(supabase, user.id, {
        caseId,
        caseName: display,
        action: "case_activated",
        description: `Set status to ${status}`,
        userEmail: user.email ?? "",
      });
      flash("Case is active again");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Could not update status");
    } finally {
      setBusy(false);
    }
  }

  async function toggleEventCompleted(ev: CalendarEvent) {
    if (!caseId || !c || !user) return;
    try {
      const supabase = getBrowserSupabase();
      const next = { ...ev, completed: !ev.completed, updatedAt: Date.now() };
      await saveEvent(supabase, caseId, next);
      flash(next.completed ? "Marked complete — not shown as overdue" : "Marked incomplete");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Could not update event");
    }
  }

  async function removeEvent(ev: CalendarEvent) {
    if (!caseId || !c || !user) return;
    setBusy(true); setMsg(null);
    try {
      if (!isGoogleIcsMirrorEvent(ev) && ev.googleEventId) {
        const res = await postCalendarSync(calendarDeletePayload(ev), idToken);
        if (!res.ok) { const j = (await res.json()) as { error?: string }; throw new Error(j.error ?? "Calendar delete failed"); }
      }
      const supabase = getBrowserSupabase();
      await deleteEvent(supabase, caseId, ev.id);
      await logActivity(supabase, user.id, {
        caseId, caseName: caseDisplayName(c),
        action: "event_deleted",
        description: `Deleted "${ev.title}" (${ev.date})`,
        userEmail: user.email ?? "",
      });
      flash(
        isGoogleIcsMirrorEvent(ev)
          ? `Removed "${ev.title}" from DocketFlow (Google Calendar unchanged)`
          : `Deleted "${ev.title}"`
      );
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Delete failed");
    } finally { setBusy(false); }
  }

  async function permanentlyDeleteCase() {
    if (!caseId || !c || !user) return;
    const wasArchived = c.status === "archived";
    if (
      !confirm(
        wasArchived
          ? "Permanently delete this archived case from DocketFlow? All deadlines and events are removed and cannot be recovered.\n\nIf anything is still on Google Calendar, those rows are removed first."
          : "Permanently delete this case and every deadline from DocketFlow?\n\nGoogle Calendar copies are removed first, then the case and all events are deleted. Archive instead if you only want to keep a read-only history here."
      )
    ) {
      return;
    }
    setBusy(true);
    setMsg(null);
    const googleTargets = events.filter((e) => !isGoogleIcsMirrorEvent(e) && e.googleEventId);
    const totalSteps = permanentDeleteProgressTotalSteps(events);
    let completed = 0;
    const pulse = (phase: string) => {
      setCaseOpProgress({
        headline: wasArchived ? "Deleting archived case" : "Permanently deleting case",
        phase,
        current: completed,
        total: totalSteps,
      });
    };
    pulse("Starting…");
    try {
      const supabase = getBrowserSupabase();
      const display = caseDisplayName(c);
      let googleRemoved = 0;
      for (const ev of googleTargets) {
        pulse(`Removing “${shortDeadlineTitle(ev.title)}” from Google Calendar…`);
        const res = await postCalendarSync(calendarDeletePayload(ev), idToken);
        if (!res.ok) {
          const j = (await res.json()) as { error?: string };
          throw new Error(j.error ?? "Calendar delete failed");
        }
        googleRemoved++;
        completed++;
        setCaseOpProgress((p) => (p ? { ...p, current: completed } : null));
      }
      pulse("Recording activity…");
      await logActivity(supabase, user.id, {
        caseId,
        caseName: display,
        action: "case_deleted",
        description: wasArchived
          ? `Permanently deleted archived case — ${events.length} DocketFlow event(s); ${googleRemoved} Google row(s) removed`
          : `Permanently deleted case — ${events.length} DocketFlow event(s); ${googleRemoved} Google row(s) removed`,
        userEmail: user.email ?? "",
      });
      completed++;
      setCaseOpProgress((p) => (p ? { ...p, current: completed } : null));

      pulse("Deleting case and all deadlines from DocketFlow…");
      await deleteCaseCascade(supabase, caseId);
      completed++;
      setCaseOpProgress((p) => (p ? { ...p, current: completed } : null));

      flash("Case permanently deleted");
      router.push("/cases");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Could not delete case");
    } finally {
      setCaseOpProgress(null);
      setBusy(false);
    }
  }

  async function saveEdit() {
    if (!editing || !caseId || !c || !user) return;
    setBusy(true); setMsg(null);
    try {
      const supabase = getBrowserSupabase();
      let updated: CalendarEvent = { ...editing, updatedAt: Date.now() };
      const day = updated.date;
      const holidayErr = validateEventScheduleAgainstFederalHolidays(
        {
          date: day,
          deadlineEndDate: updated.deadlineEndDate,
          startDateTime: pickStartTime ? updated.startDateTime : null,
        },
        holidays
      );
      if (holidayErr || editHolidayDateMsg || editHolidayEndMsg) {
        setMsg(
          holidayErr ?? editHolidayDateMsg ?? editHolidayEndMsg ?? "Choose dates that are not federal holidays."
        );
        setBusy(false);
        return;
      }
      if (pickStartTime) {
        const startIso = localDateTimePartsToIso(day, pickStartTime);
        let endIso: string;
        if (pickEndTime) {
          if (!isEndTimeAfterStartTime(pickStartTime, pickEndTime)) {
            setMsg("End time must be after start time on the event date.");
            setBusy(false);
            return;
          }
          endIso = localDateTimePartsToIso(day, pickEndTime);
        } else {
          endIso = defaultEndIso(startIso);
        }
        updated = { ...updated, startDateTime: startIso, endDateTime: endIso, deadlineEndDate: null };
      } else {
        updated = { ...updated, startDateTime: null, endDateTime: null };
        if (updated.deadlineEndDate?.trim()) {
          const de = updated.deadlineEndDate.trim().slice(0, 10);
          if (!/^\d{4}-\d{2}-\d{2}$/.test(de) || de <= day) {
            updated = { ...updated, deadlineEndDate: null };
          } else {
            updated = { ...updated, deadlineEndDate: de };
          }
        } else {
          updated = { ...updated, deadlineEndDate: null };
        }
        if (pickEndTime) {
          setMsg("Set a start time to use an end time, or clear end time for an all-day event.");
          setBusy(false);
          return;
        }
      }
      if (updated.scheduleKind === "meeting" && !pickStartTime) {
        setMsg("Meetings need a start time on the event date.");
        setBusy(false);
        return;
      }
      const ek = updated.eventKind ?? "other_event";
      if (isTaxonomyEventKind(ek)) {
        updated = { ...updated, remindersMinutes: [...getFixedRemindersForKind(ek)] };
      }
      await saveEvent(supabase, caseId, updated);
      if (!isGoogleIcsMirrorEvent(updated) && updated.googleEventId) {
        const res = await postCalendarSync({
          action: "update",
          googleEventId: updated.googleEventId,
          ...(updated.googleHostCalendarId
            ? { googleHostCalendarId: updated.googleHostCalendarId }
            : updated.googleCalendarEventIdsByEmail &&
                Object.keys(updated.googleCalendarEventIdsByEmail).length > 0
              ? { googleCalendarEventIdsByEmail: updated.googleCalendarEventIdsByEmail }
              : {}),
          caseName: caseDisplayName(c),
          title: updated.title,
          date: updated.date,
          description: googleCalendarDescription(updated),
          reminderMinutes: updated.remindersMinutes,
          location: updated.zoomLink?.trim() ?? "",
          scheduleKind: updated.scheduleKind,
          ...(updated.startDateTime ? { startDateTime: updated.startDateTime } : {}),
          ...(updated.endDateTime ? { endDateTime: updated.endDateTime } : {}),
          ...(!updated.startDateTime ? { deadlineEndDate: updated.deadlineEndDate ?? null } : {}),
          ...(updated.googleColorId !== undefined ? { googleColorId: updated.googleColorId } : {}),
        }, idToken);
        if (!res.ok) { const j = (await res.json()) as { error?: string }; throw new Error(j.error ?? "Calendar update failed"); }
      }
      await logActivity(supabase, user.id, {
        caseId, caseName: caseDisplayName(c),
        action: "event_edited",
        description: `Edited "${updated.title}" (${updated.date})`,
        userEmail: user.email ?? "",
      });
      setEditing(null);
      flash("Event saved");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Save failed");
    } finally { setBusy(false); }
  }

  async function bulkDelete() {
    if (!caseId || !c || !user || selected.size === 0) return;
    if (!confirm(`Delete ${selected.size} selected event(s)?`)) return;
    setBusy(true); setMsg(null);
    try {
      const selectedEvents = events.filter((e) => selected.has(e.id));
      for (const ev of selectedEvents) {
        if (!isGoogleIcsMirrorEvent(ev) && ev.googleEventId) {
          await postCalendarSync(calendarDeletePayload(ev), idToken);
        }
      }
      const supabase = getBrowserSupabase();
      await bulkDeleteEvents(supabase, caseId, [...selected]);
      await logActivity(supabase, user.id, {
        caseId, caseName: caseDisplayName(c),
        action: "events_bulk_deleted",
        description: `Deleted ${selected.size} events`,
        userEmail: user.email ?? "",
      });
      flash(`Deleted ${selected.size} events`);
      setSelected(new Set());
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Bulk delete failed");
    } finally { setBusy(false); }
  }

  async function bulkReschedule() {
    if (!caseId || !c || !user || selected.size === 0) return;
    const days = parseInt(shiftDays, 10);
    if (isNaN(days) || days === 0) { setMsg("Enter a non-zero number of days"); return; }
    setBusy(true); setMsg(null);
    try {
      const selectedEvents = events.filter((e) => selected.has(e.id));
      for (const ev of selectedEvents) {
        const newDate = shiftCalendarDays(ev.date, days);
        const newDeadline =
          !ev.startDateTime && ev.deadlineEndDate
            ? shiftCalendarDays(ev.deadlineEndDate, days)
            : null;
        const holidayErr = validateEventScheduleAgainstFederalHolidays(
          { date: newDate, deadlineEndDate: newDeadline, startDateTime: ev.startDateTime },
          holidays
        );
        if (holidayErr) {
          setMsg(
            `Cannot shift "${ev.title}" by ${days} day(s): ${holidayErr}`
          );
          setBusy(false);
          return;
        }
      }
      const supabase = getBrowserSupabase();
      await bulkRescheduleEvents(supabase, caseId, [...selected], days);
      for (const ev of selectedEvents) {
        if (isGoogleIcsMirrorEvent(ev) || !ev.googleEventId) continue;
        const newDate = shiftCalendarDays(ev.date, days);
        const newDeadline =
          !ev.startDateTime && ev.deadlineEndDate
            ? shiftCalendarDays(ev.deadlineEndDate, days)
            : undefined;
        const res = await postCalendarSync({
          action: "update",
          googleEventId: ev.googleEventId,
          ...(ev.googleHostCalendarId
            ? { googleHostCalendarId: ev.googleHostCalendarId }
            : ev.googleCalendarEventIdsByEmail &&
                Object.keys(ev.googleCalendarEventIdsByEmail).length > 0
              ? { googleCalendarEventIdsByEmail: ev.googleCalendarEventIdsByEmail }
              : {}),
          caseName: caseDisplayName(c),
          title: ev.title,
          date: newDate,
          description: googleCalendarDescription(ev),
          reminderMinutes: ev.remindersMinutes,
          location: ev.zoomLink?.trim() ?? "",
          scheduleKind: ev.scheduleKind,
          ...(ev.startDateTime ? { startDateTime: ev.startDateTime } : {}),
          ...(ev.endDateTime ? { endDateTime: ev.endDateTime } : {}),
          ...(!ev.startDateTime ? { deadlineEndDate: newDeadline ?? null } : {}),
          ...(ev.googleColorId !== undefined ? { googleColorId: ev.googleColorId } : {}),
        }, idToken);
        if (!res.ok) {
          const j = (await res.json()) as { error?: string };
          throw new Error(j.error ?? "Calendar update failed");
        }
      }
      await logActivity(supabase, user.id, {
        caseId, caseName: caseDisplayName(c),
        action: "events_bulk_rescheduled",
        description: `Shifted ${selected.size} events by ${days > 0 ? "+" : ""}${days} days`,
        userEmail: user.email ?? "",
      });
      flash(`Rescheduled ${selected.size} events by ${days > 0 ? "+" : ""}${days} days`);
      setSelected(new Set());
      setShowBulkReschedule(false);
      setShiftDays("");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Reschedule failed");
    } finally { setBusy(false); }
  }

  async function saveReassign() {
    if (!caseId || !c || !user) return;
    if (!reassignMainAttorneyId || !reassignParalegalId) {
      setMsg("Main attorney and paralegal are required.");
      return;
    }
    if (reassignEventAttorneyId && reassignEventAttorneyId === reassignMainAttorneyId) {
      setMsg("Event attorney must be different from the main attorney.");
      return;
    }
    setBusy(true); setMsg(null);
    try {
      const supabase = getBrowserSupabase();
      const extraIds = reassignExtraIds.filter(
        (id) =>
          id &&
          id !== reassignMainAttorneyId &&
          id !== reassignParalegalId
      );
      const newContactIds = buildCaseAssignedContactIds({
        responsibleAttorneyId: reassignMainAttorneyId,
        paralegalId: reassignParalegalId,
        extraIds,
        contactById,
      });
      await updateCase(supabase, caseId, {
        assignedContactIds: newContactIds,
        responsibleAttorneyContactId: reassignMainAttorneyId,
        eventAttorneyContactId: reassignEventAttorneyId || null,
      });
      const attendeeContactIds = caseCalendarInviteContactIds({
        assignedContactIds: newContactIds,
        eventAttorneyContactId: reassignEventAttorneyId || null,
      });
      const attendeeEmails = Array.from(
        new Set(
          attendeeContactIds
            .map((id) => contacts.find((ct) => ct.id === id)?.email)
            .filter((e): e is string => Boolean(e))
        )
      );
      const withGoogle = events.filter(
        (ev) =>
          !isGoogleIcsMirrorEvent(ev) &&
          !ev.googleHostCalendarId &&
          (ev.googleEventId ||
            (ev.googleCalendarEventIdsByEmail &&
              Object.keys(ev.googleCalendarEventIdsByEmail).length > 0))
      );
      if (withGoogle.length > 0 && attendeeEmails.length > 0) {
        const res = await postCalendarSync(
          {
            action: "reconcile_team",
            caseName: caseDisplayName(c),
            attendeeEmails,
            events: withGoogle.map((ev) => ({
              title: ev.title,
              date: ev.date,
              description: googleCalendarDescription(ev),
              reminderMinutes: ev.remindersMinutes,
              location: ev.zoomLink?.trim() ?? "",
              scheduleKind: ev.scheduleKind,
              ...(ev.startDateTime ? { startDateTime: ev.startDateTime } : {}),
              ...(ev.endDateTime ? { endDateTime: ev.endDateTime } : {}),
              ...(!ev.startDateTime ? { deadlineEndDate: ev.deadlineEndDate ?? null } : {}),
              googleEventId: ev.googleEventId,
              googleCalendarEventIdsByEmail: ev.googleCalendarEventIdsByEmail,
              ...(ev.googleColorId !== undefined ? { googleColorId: ev.googleColorId } : {}),
            })),
          },
          idToken
        );
        const data = (await res.json()) as {
          results?: { organizerEventId: string; idsByEmail: Record<string, string> }[];
          error?: string;
        };
        if (!res.ok) throw new Error(data.error ?? "Calendar reconcile failed");
        const results = data.results ?? [];
        for (let i = 0; i < withGoogle.length; i++) {
          const ev = withGoogle[i];
          const r = results[i];
          if (!r?.organizerEventId) continue;
          await saveEvent(supabase, caseId, {
            ...ev,
            googleEventId: r.organizerEventId,
            googleCalendarEventIdsByEmail: r.idsByEmail,
            updatedAt: Date.now(),
          });
        }
      }
      await logActivity(supabase, user.id, {
        caseId, caseName: caseDisplayName(c),
        action: "contacts_reassigned",
        description: `Reassigned ${newContactIds.length} contacts`,
        userEmail: user.email ?? "",
      });
      setShowReassign(false);
      flash(
        withGoogle.length > 0 && attendeeEmails.length > 0
          ? "Contacts reassigned and Google Calendar updated for synced deadlines"
          : "Contacts reassigned"
      );
      setShowReassign(false);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Reassign failed");
    } finally { setBusy(false); }
  }

  async function savePreferredLanguage(next: string) {
    if (!caseId || !c || !user) return;
    if (!isPreferredLanguage(next)) {
      setMsg("Select a preferred language.");
      return;
    }
    if (next === (c.preferredLanguage ?? "")) return;
    setBusy(true);
    setMsg(null);
    try {
      const supabase = getBrowserSupabase();
      await updateCase(supabase, caseId, { preferredLanguage: next });
      flash("Preferred language saved");
    } catch (e) {
      setEditPreferredLanguage(c.preferredLanguage ?? "");
      setMsg(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  if (!hydrated) return <PageSkeleton />;
  if (!isSupabaseConfigured()) return <PageWrapper><p className="text-text-muted">Configure Supabase.</p></PageWrapper>;
  if (!user) return null;
  if (c === undefined) return <PageWrapper><p className="text-text-muted">Loading…</p></PageWrapper>;
  if (c === null) {
    return (
      <PageWrapper>
        <p className="text-text-muted">Case not found.</p>
        <Link href="/cases" className="mt-4 inline-block text-sm font-medium text-primary hover:underline">← All Cases</Link>
      </PageWrapper>
    );
  }

  return (
    <PageWrapper>
      {c.status === "archived" && (
        <div
          role="status"
          className="mb-4 flex flex-col gap-3 rounded-xl border-2 border-warning/70 bg-warning-light/45 px-4 py-3 shadow-sm sm:flex-row sm:items-center sm:justify-between"
        >
          <div className="min-w-0">
            <p className="text-base font-bold uppercase tracking-wide text-warning">Archived case</p>
            <p className="mt-1 text-sm leading-snug text-text-secondary">
              This matter is off your active docket. Imports and new calendar events are disabled; deadlines stay here
              for reference until you use <strong className="font-medium text-text">Permanently delete case & deadlines</strong>{" "}
              below. Google Calendar rows were cleared when the case was archived (any stragglers are removed during delete).
            </p>
          </div>
          <Button
            variant="secondary"
            className="shrink-0 sm:ml-4"
            disabled={busy}
            onClick={() => void setStatus("active")}
          >
            Mark active
          </Button>
        </div>
      )}
      {/* Breadcrumb + header */}
      <div className="mb-2">
        <Link href="/cases" className="text-xs font-medium text-text-muted hover:text-primary">← All Cases</Link>
      </div>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1
            className={`text-2xl font-semibold tracking-tight lg:text-3xl ${
              c.status === "archived" ? "text-text-secondary" : "text-text"
            }`}
          >
            {caseDisplayName(c)}
          </h1>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-text-muted">
            {c.name && c.name !== caseDisplayName(c) && <span>{c.name}</span>}
            {c.court && <><span className="text-border-strong">·</span><span>{c.court}</span></>}
            {c.dateOfBirth && (
              <>
                <span className="text-border-strong">·</span>
                <span>DOB {c.dateOfBirth}</span>
              </>
            )}
            {c.dateOfIncident && (
              <>
                <span className="text-border-strong">·</span>
                <span>Incident {c.dateOfIncident}</span>
              </>
            )}
            {slackChannel && (
              <>
                <span className="text-border-strong">·</span>
                <a
                  href={slackChannelUrl(slackChannel.slackChannelId)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-medium text-primary hover:underline"
                >
                  Slack {slackChannelLabel(slackChannel.slackChannelName, slackChannel.slackChannelId)}
                </a>
              </>
            )}
            {c.status === "active" ? (
              <Badge variant="success">active</Badge>
            ) : (
              <Badge variant="warning" className="text-xs font-bold uppercase tracking-wide">
                archived
              </Badge>
            )}
            <span className="text-border-strong">·</span>
            <span className="text-sm text-text-secondary">
              {events.length} event{events.length !== 1 ? "s" : ""}
            </span>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-white px-2.5 py-1.5 text-xs font-medium text-text shadow-sm">
            <span className="text-text-muted">Language</span>
            <Select
              className="w-auto min-w-[5.75rem] border-0 bg-transparent py-0 pl-0 pr-6 text-xs focus:ring-0"
              disabled={busy}
              value={editPreferredLanguage}
              onChange={(e) => {
                const next = e.target.value;
                setEditPreferredLanguage(next);
                if (isPreferredLanguage(next)) void savePreferredLanguage(next);
              }}
              aria-label="Preferred language"
            >
              <option value="">Select…</option>
              {PREFERRED_LANGUAGE_OPTIONS.map((lang) => (
                <option key={lang} value={lang}>
                  {lang}
                </option>
              ))}
            </Select>
          </label>
          {c.status === "archived" ? (
            <span
              className="inline-flex cursor-not-allowed items-center justify-center rounded-lg border border-border bg-surface-alt px-4 py-1.5 text-sm font-medium text-text-dim"
              title="Activate the case to import dates from a document"
            >
              Import Document with Dates
            </span>
          ) : (
            <>
              <Link
                href={`/cases/${caseId}/import-aso`}
                className="inline-flex items-center justify-center rounded-lg border border-border bg-white px-4 py-1.5 text-sm font-medium text-text shadow-sm transition hover:bg-surface-alt"
              >
                Import Document with Dates
              </Link>
              <Button variant="pink" size="sm" disabled={busy} onClick={() => setShowAddEvent(true)}>
                Add calendar event
              </Button>
            </>
          )}
          <Button
            variant="secondary"
            size="sm"
            disabled={busy || verifyBusy}
            onClick={() => void runCalendarVerify()}
          >
            {verifyBusy ? "Verifying…" : "Verify Google Calendar"}
          </Button>
          {c.status === "active" && (
            <Button
              variant="secondary"
              size="sm"
              disabled={busy}
              title="Removes this case's synced deadlines from team Google Calendars. Does not delete unrelated personal calendar invites."
              onClick={() => void setStatus("archived")}
            >
              <span>Archive case</span>
              <svg
                className="h-3.5 w-3.5 shrink-0 text-text-dim"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={1.75}
                stroke="currentColor"
                aria-hidden
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z"
                />
              </svg>
            </Button>
          )}
          <Button
            variant="danger"
            size="sm"
            disabled={busy}
            className="max-w-[min(100%,280px)] whitespace-normal text-center leading-snug"
            title="Remove any remaining Google rows, then delete this case and every deadline from DocketFlow."
            onClick={() => void permanentlyDeleteCase()}
          >
            Permanently delete case & deadlines
          </Button>
        </div>
      </div>

      {/* Assigned contacts */}
      <Card className="mt-6">
        <CardBody>
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-text">Assigned Contacts</h3>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                if (showReassign) {
                  setShowReassign(false);
                  return;
                }
                const slots = caseContactSlotsFromCase(c, contactById);
                setReassignMainAttorneyId(slots.responsibleAttorneyId);
                setReassignEventAttorneyId(slots.eventAttorneyId);
                setReassignParalegalId(slots.paralegalId);
                setReassignExtraIds(slots.extraIds);
                setShowReassign(true);
              }}
            >
              {showReassign ? "Cancel" : "Reassign"}
            </Button>
          </div>
          {!showReassign ? (
            <div className="mt-3 flex flex-wrap gap-2">
              {c.assignedContactIds.length === 0 && (
                <span className="text-sm text-text-muted">No contacts assigned</span>
              )}
              {c.assignedContactIds.map((id, idx) => {
                const ct = contacts.find((x) => x.id === id);
                const caseRole = caseContactDisplayLabel(id, c, contactById);
                return (
                  <span
                    key={`${id}-${idx}`}
                    className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface-alt px-3 py-1 text-xs font-medium text-text"
                  >
                    {ct ? ct.name : "Unknown contact"}
                    {caseRole ? (
                      <Badge variant="success">{caseRole}</Badge>
                    ) : (
                      ct && <Badge variant="default">{ct.role.replace("_", " ")}</Badge>
                    )}
                  </span>
                );
              })}
              {c.eventAttorneyContactId?.trim() && (() => {
                const id = c.eventAttorneyContactId!.trim();
                const ct = contacts.find((x) => x.id === id);
                return (
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface-alt px-3 py-1 text-xs font-medium text-text">
                    {ct ? ct.name : "Unknown contact"}
                    <Badge variant="default">Event attorney</Badge>
                  </span>
                );
              })()}
            </div>
          ) : (
            <div className="mt-3 space-y-4">
              <div>
                <Label required>Main attorney</Label>
                <Select
                  className="mt-1.5"
                  value={reassignMainAttorneyId}
                  onChange={(e) => setReassignMainAttorneyId(e.target.value)}
                >
                  <option value="">Select…</option>
                  {attorneys.map((ct) => (
                    <option key={ct.id} value={ct.id}>{ct.name}</option>
                  ))}
                </Select>
              </div>
              <div>
                <Label>Event attorney</Label>
                <Select
                  className="mt-1.5"
                  value={reassignEventAttorneyId}
                  onChange={(e) => setReassignEventAttorneyId(e.target.value)}
                >
                  <option value="">None</option>
                  {attorneys
                    .filter((ct) => ct.id !== reassignMainAttorneyId)
                    .map((ct) => (
                      <option key={ct.id} value={ct.id}>{ct.name}</option>
                    ))}
                </Select>
                <p className="mt-1 text-xs text-text-muted">
                  Calendar invites only — not stored in assigned contacts (Case Tracker safe).
                </p>
              </div>
              <div>
                <Label required>Paralegal</Label>
                <Select
                  className="mt-1.5"
                  value={reassignParalegalId}
                  onChange={(e) => setReassignParalegalId(e.target.value)}
                >
                  <option value="">Select…</option>
                  {paralegals.map((ct) => (
                    <option key={ct.id} value={ct.id}>{ct.name}</option>
                  ))}
                </Select>
              </div>
              <div>
                <Label>Additional people</Label>
                <div className="mt-2 space-y-2">
                  {reassignExtraIds.map((rid, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <Select
                        className="min-w-0 flex-1"
                        value={rid}
                        onChange={(e) => {
                          const next = [...reassignExtraIds];
                          next[i] = e.target.value;
                          setReassignExtraIds(next);
                        }}
                      >
                        <option value="">Select contact…</option>
                        {contacts
                          .filter(
                            (ct) =>
                              ct.id !== reassignMainAttorneyId &&
                              ct.id !== reassignParalegalId &&
                              ct.role !== "attorney"
                          )
                          .map((ct) => (
                            <option key={ct.id} value={ct.id}>
                              {ct.name} ({ct.role.replace("_", " ")})
                            </option>
                          ))}
                      </Select>
                      <button
                        type="button"
                        className="text-danger hover:text-danger/80"
                        onClick={() => setReassignExtraIds(reassignExtraIds.filter((_, j) => j !== i))}
                      >
                        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                      </button>
                    </div>
                  ))}
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="mt-2"
                  onClick={() => setReassignExtraIds([...reassignExtraIds, ""])}
                >
                  + Add person
                </Button>
              </div>
              <Button size="sm" disabled={busy} onClick={() => void saveReassign()}>Save</Button>
            </div>
          )}
        </CardBody>
      </Card>

      {msg && (
        <div className="mt-4 rounded-lg border border-danger/20 bg-danger-light px-4 py-3" role="alert">
          <p className="text-sm text-danger">{msg}</p>
        </div>
      )}
      {successMsg && (
        <div className="mt-4 rounded-lg border border-success/20 bg-success-light px-4 py-3">
          <p className="text-sm text-success">{successMsg}</p>
        </div>
      )}

      {verifyResult && (
        <Card className="mt-4 border-primary/20">
          <CardBody>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <h3 className="text-sm font-semibold text-text">Calendar verification</h3>
                <p className="mt-0.5 text-xs text-text-muted">
                  Checked {verifyResult.summary.totalChecks} stored cop
                  {verifyResult.summary.totalChecks !== 1 ? "ies" : "y"} via Google Calendar API
                  {" · "}
                  {new Date(verifyResult.checkedAt).toLocaleString()}
                </p>
                <p className="mt-2 text-xs text-text-dim">
                  Each row is one person&apos;s primary calendar. Legacy syncs may only list the organizer until
                  you reassign or recreate with the full team map.
                </p>
              </div>
              <Badge variant={verifyResult.summary.failed === 0 ? "success" : "warning"}>
                {verifyResult.summary.ok} ok
                {verifyResult.summary.failed > 0
                  ? ` · ${verifyResult.summary.failed} issue${verifyResult.summary.failed !== 1 ? "s" : ""}`
                  : ""}
              </Badge>
            </div>
            <ul className="mt-4 max-h-72 space-y-3 overflow-y-auto text-sm">
              {verifyResult.events.map((row, idx) => (
                <li key={`${row.date}-${idx}-${row.title.slice(0, 24)}`} className="rounded-lg border border-border bg-surface-alt/50 px-3 py-2">
                  <p className="font-medium text-text">{row.title}</p>
                  <p className="text-xs text-text-muted">{row.date}</p>
                  <ul className="mt-2 space-y-1">
                    {row.checks.map((ch) => (
                      <li key={ch.email} className="flex flex-wrap items-baseline gap-x-2 text-xs">
                        <span className={ch.ok ? "text-success" : "text-danger"}>
                          {ch.ok ? "✓" : "✗"} {ch.email}
                        </span>
                        {ch.ok && ch.summary && (
                          <span className="text-text-dim truncate max-w-[220px]" title={ch.summary}>
                            {ch.summary}
                          </span>
                        )}
                        {ch.error && (
                          <span className="text-danger">{ch.error}</span>
                        )}
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      )}

      {/* Bulk action bar */}
      {selected.size > 0 && (
        <div className="sticky top-0 z-40 mt-6 flex flex-wrap items-center gap-3 rounded-xl border border-primary/20 bg-primary-light px-5 py-3 shadow-sm">
          <span className="text-sm font-semibold text-primary">{selected.size} selected</span>
          <div className="h-4 w-px bg-primary/20" />
          <Button variant="danger" size="sm" disabled={busy} onClick={() => void bulkDelete()}>
            Delete selected
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setShowBulkReschedule(!showBulkReschedule)}>
            Reschedule selected
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>Clear</Button>
          {showBulkReschedule && (
            <div className="flex items-center gap-2">
              <Input
                type="number"
                placeholder="± days"
                className="!w-24"
                value={shiftDays}
                onChange={(e) => setShiftDays(e.target.value)}
              />
              <Button size="sm" disabled={busy} onClick={() => void bulkReschedule()}>Apply</Button>
            </div>
          )}
        </div>
      )}

      {/* Timeline / month calendar */}
      <Card className="mt-6">
        <CardHeader>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h2 className="text-base font-semibold text-text">Events · {events.length}</h2>
              <div className="mt-2 inline-flex rounded-lg border border-border bg-surface-alt p-0.5">
                <button
                  type="button"
                  onClick={() => setEventViewMode("timeline")}
                  className={`rounded-md px-3 py-1.5 text-xs font-semibold transition ${
                    eventViewMode === "timeline"
                      ? "bg-primary text-white shadow-sm"
                      : "text-text-muted hover:text-text"
                  }`}
                >
                  Timeline
                </button>
                <button
                  type="button"
                  onClick={() => setEventViewMode("month")}
                  className={`rounded-md px-3 py-1.5 text-xs font-semibold transition ${
                    eventViewMode === "month"
                      ? "bg-primary text-white shadow-sm"
                      : "text-text-muted hover:text-text"
                  }`}
                >
                  Month
                </button>
              </div>
            </div>
            {events.length > 0 && (
              <button
                type="button"
                className="shrink-0 self-start text-xs font-medium text-primary hover:underline disabled:cursor-not-allowed disabled:opacity-40"
                disabled={eventViewMode === "month" && eventIdsInMonth.length === 0}
                onClick={toggleAll}
              >
                {eventViewMode === "month"
                  ? allInMonthSelected
                    ? "Deselect month"
                    : "Select month"
                  : selected.size === events.length
                    ? "Deselect all"
                    : "Select all"}
              </button>
            )}
          </div>
        </CardHeader>
        <CardBody className="p-0">
          {events.length === 0 ? (
            <div className="px-6 py-10 text-center text-sm text-text-muted">No events on this case.</div>
          ) : eventViewMode === "month" ? (
            <div className="border-t border-border p-4 sm:p-6">
              <MonthlyEventCalendar month={monthCursor} chips={caseMonthChips} onMonthChange={setMonthCursor} />
              {caseMonthChips.length === 0 && (
                <p className="mt-4 text-center text-sm text-text-muted">No events in {format(parseISO(`${monthCursor}-01`), "MMMM yyyy")}.</p>
              )}
            </div>
          ) : (
            <div className="divide-y divide-border">
              {sortedEvents.map((ev) => {
                const overdue = isCalendarEventOverdue(ev);
                return (
                <div
                  key={ev.id}
                  className={`flex gap-4 px-6 py-4 transition-colors ${
                    selected.has(ev.id) ? "bg-primary/[0.04]" : ""
                  } ${overdue ? "border-l-4 border-l-danger bg-danger/[0.05]" : ""}`}
                >
                  <div className="flex flex-col items-center gap-1 pt-0.5">
                    <input
                      type="checkbox"
                      checked={selected.has(ev.id)}
                      onChange={() => toggleSelect(ev.id)}
                      className="h-4 w-4 rounded border-border text-primary focus:ring-primary/30"
                    />
                    <div className="flex-1 w-px bg-border" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`text-sm font-semibold tabular-nums ${
                          overdue ? "text-danger" : "text-text"
                        }`}
                      >
                        {ev.startDateTime
                          ? ev.date
                          : ev.deadlineEndDate && ev.deadlineEndDate > ev.date
                            ? `${ev.date} → ${ev.deadlineEndDate}`
                            : ev.date}
                      </span>
                      {ev.startDateTime && (
                        <span className="text-xs font-medium text-text-secondary">
                          {formatEventAt(ev.startDateTime)}
                          {ev.endDateTime ? (
                            <>
                              {" "}
                              → {formatEventAt(ev.endDateTime)}
                            </>
                          ) : null}
                        </span>
                      )}
                      {ev.eventKind && (
                        <Badge variant="default">
                          {EVENT_KIND_LABELS[ev.eventKind ?? "other_event"]}
                        </Badge>
                      )}
                      <Badge variant={catBadge[ev.category]}>{ev.category}</Badge>
                      {ev.scheduleKind === "meeting" ? (
                        <Badge variant="primary">📅 Meeting</Badge>
                      ) : (
                        <Badge variant="warning">⏰ Deadline</Badge>
                      )}
                      {isGoogleIcsMirrorEvent(ev) ? (
                        <Badge variant="default">Originally from Google</Badge>
                      ) : (
                        hasGoogleCalendarSync(ev) && <Badge variant="success">Synced</Badge>
                      )}
                      {ev.noiseFlag && <Badge variant="warning">{ev.noiseReason ?? "Noise"}</Badge>}
                      {overdue && <Badge variant="danger">Overdue</Badge>}
                      {ev.completed && <Badge variant="success">Complete</Badge>}
                    </div>
                    <p
                      className={`mt-1 text-sm font-medium ${
                        ev.completed
                          ? "text-text-muted line-through"
                          : overdue
                            ? "text-danger"
                            : "text-text"
                      }`}
                    >
                      {ev.title}
                    </p>
                    {ev.deponentOrSubject && (
                      <p className="mt-0.5 text-xs text-text-secondary">
                        <span className="font-medium text-text-muted">Deponent / subject:</span>{" "}
                        {ev.deponentOrSubject}
                      </p>
                    )}
                    {ev.description && <p className="mt-0.5 text-sm text-text-muted line-clamp-2">{ev.description}</p>}
                    <p className="mt-0.5 text-xs text-text-dim">{eventCreatorLine(ev, user?.id, user?.email)}</p>
                    {ev.externalAttendeesText && (
                      <p className="mt-0.5 text-xs text-text-dim line-clamp-1">
                        <span className="font-medium text-text-muted">Attendees:</span> {ev.externalAttendeesText}
                      </p>
                    )}
                    {(ev.extraInternalContactIds?.length ?? 0) > 0 && (
                      <p className="mt-0.5 text-xs text-text-dim">
                        <span className="font-medium text-text-muted">Also invited:</span>{" "}
                        {contactNamesForIds(ev.extraInternalContactIds ?? [], contacts).join(", ")}
                      </p>
                    )}
                    {ev.zoomLink?.trim() && (
                      <p className="mt-1">
                        <a
                          href={ev.zoomLink.trim()}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs font-semibold text-primary hover:underline"
                          onClick={(e) => e.stopPropagation()}
                        >
                          Open join link (Zoom / video)
                        </a>
                      </p>
                    )}
                    <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2">
                      <label className="flex cursor-pointer items-center gap-1.5 text-xs font-medium text-text-secondary">
                        <input
                          type="checkbox"
                          checked={Boolean(ev.completed)}
                          onChange={() => void toggleEventCompleted(ev)}
                          className="h-4 w-4 rounded border-border text-primary focus:ring-primary/30"
                        />
                        Complete
                      </label>
                      <button type="button" className="text-xs font-medium text-primary hover:underline" onClick={() => setEditing(calendarEventForEdit(ev))}>Edit</button>
                      {canManageEventAttendees(c, ev).ok && (
                        <button
                          type="button"
                          className="text-xs font-medium text-primary hover:underline disabled:cursor-not-allowed disabled:opacity-50"
                          disabled={busy}
                          onClick={() => setAddingPeopleTo(ev)}
                        >
                          Add people
                        </button>
                      )}
                      {c.status === "active" &&
                        !isGoogleIcsMirrorEvent(ev) &&
                        !isBackfillNonSyncEvent(ev) &&
                        !ev.completed &&
                        ev.included &&
                        !hasGoogleCalendarSync(ev) && (
                          <button
                            type="button"
                            className="text-xs font-medium text-primary hover:underline disabled:cursor-not-allowed disabled:opacity-50"
                            disabled={busy || Boolean(creatingGoogleInviteId) || !idToken}
                            onClick={() => void createGoogleInviteForEvent(ev)}
                          >
                            {creatingGoogleInviteId === ev.id ? "Creating invite…" : "Create Google invite"}
                          </button>
                        )}
                      <button type="button" className="text-xs font-medium text-danger hover:underline" onClick={() => void removeEvent(ev)} disabled={busy}>Remove</button>
                    </div>
                  </div>
                </div>
              );
              })}
            </div>
          )}
        </CardBody>
      </Card>

      {c && user && (
        <AddCalendarEventModal
          open={showAddEvent}
          onClose={() => setShowAddEvent(false)}
          lockedCase={c}
          casePickerOptions={[]}
          contacts={contacts}
          idToken={idToken}
          user={{ id: user.id, email: user.email }}
          onSaved={({ title }) => flash(`Added "${title}" to the case and calendar`)}
        />
      )}

      {addingPeopleTo && c && user && (
        <EventAttendeesModal
          open
          onClose={() => setAddingPeopleTo(null)}
          caseRecord={c}
          event={addingPeopleTo}
          contacts={contacts}
          idToken={idToken}
          user={{ id: user.id, email: user.email }}
          onSaved={(message) => flash(message)}
          onError={(message) => setMsg(message)}
        />
      )}

      {/* Edit modal */}
      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
          <Card className="max-h-[min(90vh,880px)] w-full max-w-lg overflow-y-auto shadow-2xl">
            <CardHeader><h3 className="text-base font-semibold text-text">Edit Event</h3></CardHeader>
            <CardBody className="space-y-4">
              {isGoogleIcsMirrorEvent(editing) && (
                <div className="rounded-lg border border-border bg-surface-alt/80 px-4 py-3 text-sm text-text-secondary">
                  <p className="font-medium text-text">Originally from Google Calendar</p>
                  <p className="mt-1 text-xs text-text-muted">
                    This entry is only in DocketFlow for your workflow. To change the real calendar event, edit it in{" "}
                    <span className="font-medium text-text-secondary">Google Calendar</span>. You can still update fields
                    here for notes and DocketFlow lists, or remove the entry from this case (Google is not changed).
                  </p>
                </div>
              )}
              <div>
                <Label>Event type</Label>
                <Select
                  className="mt-1.5"
                  value={editing.eventKind ?? "other_event"}
                  onChange={(e) => {
                    const k = e.target.value as EventKind;
                    const next: CalendarEvent = {
                      ...editing,
                      eventKind: k,
                      category: categoryForManualEventKind(k),
                    };
                    if (isTaxonomyEventKind(k)) {
                      next.remindersMinutes = [...getFixedRemindersForKind(k)];
                    }
                    setEditing(next);
                  }}
                >
                  {eventKindSelectGroups.map((g) => (
                    <optgroup key={g.topic} label={g.topic}>
                      {g.options.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </Select>
              </div>
              <div>
                <Label>Deadline vs meeting</Label>
                <Select
                  className="mt-1.5"
                  value={editing.scheduleKind ?? "deadline"}
                  onChange={(e) =>
                    setEditing({
                      ...editing,
                      scheduleKind: e.target.value as EventScheduleKind,
                      ...(e.target.value === "meeting" ? { deadlineEndDate: null } : {}),
                    })
                  }
                >
                  <option value="deadline">⏰ Deadline (all-day friendly)</option>
                  <option value="meeting">📅 Meeting (time-based)</option>
                </Select>
                <p className="mt-1 text-xs text-text-dim">
                  Meetings should have a start time below. Deadlines are usually all-day unless you set times.
                </p>
              </div>
              <div>
                <Label>Category</Label>
                <Select
                  className="mt-1.5"
                  value={editing.category}
                  onChange={(e) => setEditing({ ...editing, category: e.target.value as EventCategory })}
                >
                  {(["trial", "mediation", "experts", "motions", "discovery", "pretrial", "other"] as const).map(
                    (cat) => (
                      <option key={cat} value={cat}>{cat}</option>
                    )
                  )}
                </Select>
              </div>
              <div><Label>Title</Label><Input className="mt-1.5" value={editing.title} onChange={(e) => setEditing({ ...editing, title: e.target.value })} /></div>
              <div>
                <Label>Event date</Label>
                <FederalHolidayDateInput
                  className="mt-1.5"
                  value={editing.date}
                  holidays={holidays}
                  onValueChange={(date) => setEditing({ ...editing, date })}
                  onBlocked={setEditHolidayDateMsg}
                />
                <FederalHolidayBlockedNotice message={editHolidayDateMsg} />
                <p className="mt-1 text-xs text-text-dim">
                  Times below apply only to this day. US federal holidays cannot be selected.
                </p>
              </div>
              {(editing.scheduleKind ?? "deadline") === "deadline" && !pickStartTime && (
                <div>
                  <Label>Last day of deadline (optional)</Label>
                  <FederalHolidayDateInput
                    className="mt-1.5"
                    min={editing.date}
                    value={editing.deadlineEndDate ?? ""}
                    holidays={holidays}
                    spanStart={editing.date}
                    disabled={!editing.date}
                    onValueChange={(deadlineEndDate) =>
                      setEditing({
                        ...editing,
                        deadlineEndDate: deadlineEndDate.trim() || null,
                      })
                    }
                    onBlocked={setEditHolidayEndMsg}
                  />
                  <FederalHolidayBlockedNotice message={editHolidayEndMsg} />
                  <p className="mt-1 text-xs text-text-dim">
                    Leave blank for a single-day deadline. Set to the last calendar day (inclusive) for a span across
                    multiple days — Google Calendar shows one all-day block. No day in the span may be a federal
                    holiday.
                  </p>
                </div>
              )}
              <FiveMinuteTimeSelect
                label="Start time (optional)"
                value={pickStartTime}
                onChange={(t) => {
                  setPickStartTime(t);
                  if (!t) setPickEndTime("");
                }}
                allowNoTime
                noTimeLabel="No time (date-only / all day)"
                hint="5-minute increments. Matches the event date above."
              />
              <FiveMinuteTimeSelect
                label="End time (optional)"
                value={pickEndTime}
                onChange={setPickEndTime}
                allowNoTime
                noTimeLabel={pickStartTime ? "Default (+1 hour after start)" : "No end time"}
                disabled={!pickStartTime}
                hint={
                  pickStartTime
                    ? "Same day as the event date. Default adds one hour after start."
                    : "End time does not apply while the event is date-only / all-day."
                }
              />
              <div>
                <Label>Deponent / subject</Label>
                <Input
                  className="mt-1.5"
                  value={editing.deponentOrSubject ?? ""}
                  onChange={(e) => setEditing({ ...editing, deponentOrSubject: e.target.value || null })}
                />
              </div>
              <div>
                <Label>Zoom / video link</Label>
                <Input
                  className="mt-1.5"
                  type="url"
                  inputMode="url"
                  value={editing.zoomLink ?? ""}
                  onChange={(e) => setEditing({ ...editing, zoomLink: e.target.value || null })}
                  placeholder="https://…"
                />
              </div>
              {!isGoogleIcsMirrorEvent(editing) && (
                <GoogleCalendarInviteColorPicker
                  value={editing.googleColorId}
                  onChange={(next) => setEditing({ ...editing, googleColorId: next })}
                />
              )}
              {c?.status === "active" &&
                !isGoogleIcsMirrorEvent(editing) &&
                !isBackfillNonSyncEvent(editing) &&
                !editing.completed &&
                editing.included &&
                !hasGoogleCalendarSync(editing) && (
                  <div className="rounded-lg border border-border bg-surface-alt/60 px-4 py-3 text-sm text-text-secondary">
                    <p className="font-medium text-text">Google Calendar invite</p>
                    <p className="mt-1 text-xs text-text-muted">
                      Creates a DocketFlow-managed invite from the <span className="font-medium text-text-secondary">last saved</span>{" "}
                      version of this deadline. Save changes above first if you edited title, date, or times.
                    </p>
                    <Button
                      variant="secondary"
                      size="sm"
                      className="mt-2"
                      type="button"
                      disabled={busy || creatingGoogleInviteId !== null || !idToken}
                      onClick={() => void createGoogleInviteForEvent(editing)}
                    >
                      {creatingGoogleInviteId === editing.id ? "Creating invite…" : "Create Google invite"}
                    </Button>
                  </div>
                )}
              <div>
                <Label>External attendees / parties</Label>
                <Textarea
                  rows={2}
                  className="mt-1.5"
                  value={editing.externalAttendeesText ?? ""}
                  onChange={(e) => setEditing({ ...editing, externalAttendeesText: e.target.value || null })}
                />
              </div>
              <div><Label>Description / internal notes</Label><Textarea rows={4} className="mt-1.5" value={editing.description} onChange={(e) => setEditing({ ...editing, description: e.target.value })} /></div>
              <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border bg-surface-alt/50 px-4 py-3">
                <input
                  type="checkbox"
                  className="mt-1 h-4 w-4 rounded border-border text-primary focus:ring-primary/30"
                  checked={Boolean(editing.completed)}
                  onChange={(e) => setEditing({ ...editing, completed: e.target.checked })}
                />
                <span>
                  <span className="block text-sm font-medium text-text">Mark completed</span>
                  <span className="mt-0.5 block text-xs text-text-muted">
                    Omits this deadline from overdue, dashboard urgency lists, reminder emails, and the global Calendar tab.
                  </span>
                </span>
              </label>
              {isTaxonomyEventKind(editing.eventKind ?? "other_event") ? (
                <FixedRemindersReadout minutes={getFixedRemindersForKind(editing.eventKind ?? "other_event")} />
              ) : (
                <ReminderMinutesEditor
                  value={editing.remindersMinutes}
                  onChange={(minutes) => setEditing({ ...editing, remindersMinutes: minutes })}
                />
              )}
              <div className="flex justify-end gap-3 pt-2">
                <Button variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
                <Button
                  disabled={busy || Boolean(editHolidayDateMsg) || Boolean(editHolidayEndMsg)}
                  onClick={() => void saveEdit()}
                >
                  Save Changes
                </Button>
              </div>
            </CardBody>
          </Card>
        </div>
      )}

      {caseOpProgress && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/45 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="case-op-progress-title"
          aria-live="polite"
        >
          <div className="w-full max-w-md rounded-2xl border border-border bg-white p-6 shadow-xl">
            <h2 id="case-op-progress-title" className="text-base font-semibold text-text">
              {caseOpProgress.headline}
            </h2>
            <p className="mt-2 text-sm text-text-secondary">{caseOpProgress.phase}</p>
            <div className="mt-4 h-2.5 w-full overflow-hidden rounded-full bg-surface-alt">
              <div
                className="h-full rounded-full bg-primary transition-[width] duration-300 ease-out"
                style={{
                  width: `${
                    caseOpProgress.total > 0
                      ? Math.min(100, Math.round((caseOpProgress.current / caseOpProgress.total) * 100))
                      : 0
                  }%`,
                }}
              />
            </div>
            <p className="mt-2 text-xs tabular-nums text-text-dim">
              Step {caseOpProgress.current} of {caseOpProgress.total}
            </p>
            <p className="mt-3 text-xs text-text-muted">
              Please wait — each Google Calendar request takes a moment. Avoid refreshing; this overlay will disappear
              when finished.
            </p>
          </div>
        </div>
      )}
    </PageWrapper>
  );
}
