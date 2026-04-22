"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { getBrowserSupabase } from "@/lib/supabase/singleton";
import { caseDisplayName } from "@/lib/case-display";
import { googleCalendarDescription } from "@/lib/calendar-payload";
import { createAdHocCalendarEvent, defaultEndIso } from "@/lib/event-factory";
import {
  ALL_EVENT_KIND_SELECT_GROUPS,
  DEFAULT_MANUAL_EVENT_KIND,
  EVENT_KIND_LABELS,
  MANUAL_EVENT_KIND_GROUPS,
  categoryForManualEventKind,
  manualEventNeedsDeponentField,
  suggestedTitleForManualEvent,
} from "@/lib/one-off-events";
import { DEFAULT_REMINDERS } from "@/lib/reminder-presets";
import {
  bulkDeleteEvents,
  bulkRescheduleEvents,
  clearEventGoogleCalendarFields,
  deleteEvent,
  logActivity,
  saveEvent,
  subscribeCase,
  subscribeContacts,
  subscribeEvents,
  updateCase,
} from "@/lib/supabase/repo";
import type { CalendarEvent, Case, CaseStatus, Contact, EventCategory, EventKind } from "@/lib/types";
import { PageSkeleton } from "@/components/PageSkeleton";
import { ReminderMinutesEditor } from "@/components/ReminderMinutesEditor";
import { FiveMinuteTimeSelect } from "@/components/FiveMinuteTimeSelect";
import {
  defaultLocalStartParts,
  isEndTimeAfterStartTime,
  isoToLocalDateTimeParts,
  localDateTimePartsToIso,
} from "@/lib/five-minute-datetime";
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

async function calendarApi(body: unknown, idToken: string | null): Promise<Response> {
  return fetch("/api/calendar/sync", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

/** Delete body for `/api/calendar/sync` — SOL host rows use `googleHostCalendarId` instead of per-user copies */
function calendarDeletePayload(ev: CalendarEvent): {
  action: "delete";
  googleEventId: string;
  googleHostCalendarId?: string;
  googleCalendarEventIdsByEmail?: Record<string, string>;
} {
  const base = { action: "delete" as const, googleEventId: ev.googleEventId! };
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
  const [msg, setMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Bulk selection
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showBulkReschedule, setShowBulkReschedule] = useState(false);
  const [shiftDays, setShiftDays] = useState("");

  // Reassign
  const [showReassign, setShowReassign] = useState(false);
  const [reassignIds, setReassignIds] = useState<string[]>([]);

  const [verifyBusy, setVerifyBusy] = useState(false);
  const [verifyResult, setVerifyResult] = useState<VerifyResponse | null>(null);

  const [showAddEvent, setShowAddEvent] = useState(false);
  const [addKind, setAddKind] = useState<EventKind>(DEFAULT_MANUAL_EVENT_KIND);
  const [addTitle, setAddTitle] = useState("");
  const [addDeponent, setAddDeponent] = useState("");
  const [addEventDate, setAddEventDate] = useState("");
  const [addStartTime, setAddStartTime] = useState("");
  const [addEndTime, setAddEndTime] = useState("");
  const [addZoom, setAddZoom] = useState("");
  const [addExternal, setAddExternal] = useState("");
  const [addNotes, setAddNotes] = useState("");
  const [addReminders, setAddReminders] = useState<number[]>(() => [...DEFAULT_REMINDERS.discovery]);
  /** Extra invite rows: contact ids (same pattern as new case “additional people”) */
  const [addExtraInviteeRowIds, setAddExtraInviteeRowIds] = useState<string[]>([]);

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
    const cat = categoryForManualEventKind(addKind);
    setAddReminders([...DEFAULT_REMINDERS[cat]]);
  }, [addKind]);

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
    setPickStartTime(
      editing.startDateTime ? isoToLocalDateTimeParts(editing.startDateTime).time : ""
    );
    setPickEndTime(editing.endDateTime ? isoToLocalDateTimeParts(editing.endDateTime).time : "");
  }, [editing]);

  function flash(message: string) {
    setSuccessMsg(message);
    setTimeout(() => setSuccessMsg(null), 3000);
  }

  function openAddEventModal() {
    const { date, time } = defaultLocalStartParts();
    const kind = DEFAULT_MANUAL_EVENT_KIND;
    setAddKind(kind);
    setAddTitle("");
    setAddDeponent("");
    setAddEventDate(date);
    setAddStartTime(time);
    setAddEndTime("");
    setAddZoom("");
    setAddExternal("");
    setAddNotes("");
    setAddReminders([...DEFAULT_REMINDERS[categoryForManualEventKind(kind)]]);
    setAddExtraInviteeRowIds([]);
    setMsg(null);
    setShowAddEvent(true);
  }

  async function saveNewCalendarEvent() {
    if (!caseId || !c || !user?.id || !idToken) return;
    if (manualEventNeedsDeponentField(addKind) && !addDeponent.trim()) {
      setMsg("Enter who is being deposed (or the witness name).");
      return;
    }
    if (!addEventDate.trim()) {
      setMsg("Event date is required.");
      return;
    }
    if (addEndTime && !addStartTime) {
      setMsg("Set a start time before an end time — both are on the same day as the event.");
      return;
    }
    if (addStartTime && addEndTime && !isEndTimeAfterStartTime(addStartTime, addEndTime)) {
      setMsg("End time must be after start time on that day.");
      return;
    }
    if (addStartTime) {
      const startIso = localDateTimePartsToIso(addEventDate, addStartTime);
      if (Number.isNaN(new Date(startIso).getTime())) {
        setMsg("Invalid start time.");
        return;
      }
    }
    const title =
      addTitle.trim() || suggestedTitleForManualEvent(addKind, addDeponent);
    const cat = categoryForManualEventKind(addKind);

    setBusy(true);
    setMsg(null);
    try {
      const supabase = getBrowserSupabase();
      const displayName = caseDisplayName(c);
      const inviteContactIds = [
        ...new Set([...c.assignedContactIds, ...addExtraInviteeRowIds.filter(Boolean)]),
      ];
      const attendeeEmails = Array.from(
        new Set(
          inviteContactIds
            .map((id) => contacts.find((ct) => ct.id === id)?.email)
            .filter((e): e is string => Boolean(e?.trim()))
            .map((e) => e.trim().toLowerCase())
        )
      );
      if (attendeeEmails.length === 0) {
        setMsg("Assign contacts with email addresses before syncing to Google Calendar.");
        setBusy(false);
        return;
      }

      const draft = createAdHocCalendarEvent(caseId, user.id, {
        eventDate: addEventDate,
        startTime: addStartTime || null,
        endTime: addStartTime && addEndTime ? addEndTime : null,
        eventKind: addKind,
        title,
        description: addNotes.trim(),
        category: cat,
        deponentOrSubject: addDeponent.trim() || null,
        externalAttendeesText: addExternal.trim() || null,
        zoomLink: addZoom.trim() || null,
        remindersMinutes: addReminders,
      });

      await saveEvent(supabase, caseId, draft);

      const calDesc = googleCalendarDescription(draft);
      const calRes = await calendarApi(
        {
          action: "create",
          caseName: displayName,
          sourceLabel: "Manual event",
          events: [
            {
              title: draft.title,
              date: draft.date,
              description: calDesc,
              reminderMinutes: draft.remindersMinutes,
              startDateTime: draft.startDateTime ?? undefined,
              endDateTime: draft.endDateTime ?? undefined,
              ...(draft.zoomLink?.trim() ? { location: draft.zoomLink.trim() } : {}),
            },
          ],
          attendeeEmails,
        },
        idToken
      );
      const calJson = (await calRes.json()) as {
        googleEventIds?: string[];
        googleEventIdMaps?: Record<string, string>[];
        error?: string;
      };
      if (!calRes.ok) throw new Error(calJson.error ?? "Google Calendar sync failed");

      const ge = calJson.googleEventIds?.[0];
      const map = calJson.googleEventIdMaps?.[0];
      let saved = draft;
      if (ge) {
        saved = {
          ...draft,
          googleEventId: ge,
          ...(map && Object.keys(map).length ? { googleCalendarEventIdsByEmail: map } : {}),
        };
        await saveEvent(supabase, caseId, saved);
      }

      await logActivity(supabase, user.id, {
        caseId,
        caseName: displayName,
        action: "event_created",
        description: `Added "${saved.title}" (${saved.date})`,
        userEmail: user.email ?? "",
      });

      setShowAddEvent(false);
      flash(`Added "${saved.title}" to the case and calendar`);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Could not add event");
    } finally {
      setBusy(false);
    }
  }

  async function runCalendarVerify() {
    if (!idToken) return;
    const toVerify = events.filter(
      (e) =>
        e.googleEventId ||
        (e.googleCalendarEventIdsByEmail &&
          Object.keys(e.googleCalendarEventIdsByEmail).length > 0)
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

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    if (selected.size === events.length) setSelected(new Set());
    else setSelected(new Set(events.map((e) => e.id)));
  }

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
      try {
        let removed = 0;
        for (const ev of events) {
          if (ev.googleEventId) {
            const res = await calendarApi(calendarDeletePayload(ev), idToken);
            if (!res.ok) {
              const j = (await res.json()) as { error?: string };
              throw new Error(j.error ?? "Calendar delete failed");
            }
            removed++;
          }
          if (
            ev.googleEventId ||
            ev.googleHostCalendarId ||
            (ev.googleCalendarEventIdsByEmail &&
              Object.keys(ev.googleCalendarEventIdsByEmail).length > 0)
          ) {
            await clearEventGoogleCalendarFields(supabase, caseId, ev.id);
          }
        }
        await updateCase(supabase, caseId, { status });
        await logActivity(supabase, user.id, {
          caseId,
          caseName: display,
          action: "case_archived",
          description: `Archived case — removed ${removed} event(s) from Google Calendar`,
          userEmail: user.email ?? "",
        });
        flash("Case archived — Google Calendar copies removed");
      } catch (e) {
        setMsg(e instanceof Error ? e.message : "Archive failed");
      } finally {
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

  async function removeEvent(ev: CalendarEvent) {
    if (!caseId || !c || !user) return;
    setBusy(true); setMsg(null);
    try {
      if (ev.googleEventId) {
        const res = await calendarApi(calendarDeletePayload(ev), idToken);
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
      flash(`Deleted "${ev.title}"`);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Delete failed");
    } finally { setBusy(false); }
  }

  async function destroyCase() {
    if (!caseId || !c || !user) return;
    if (
      !confirm(
        "Archive this case and delete all calendar events? Every Google Calendar copy for these deadlines will be removed. The case and all events stay in DocketFlow as archived history."
      )
    ) {
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const supabase = getBrowserSupabase();
      const display = caseDisplayName(c);
      let removed = 0;
      for (const ev of events) {
        if (ev.googleEventId) {
          const res = await calendarApi(calendarDeletePayload(ev), idToken);
          if (!res.ok) {
            const j = (await res.json()) as { error?: string };
            throw new Error(j.error ?? "Calendar delete failed");
          }
          removed++;
        }
        if (
          ev.googleEventId ||
          ev.googleHostCalendarId ||
          (ev.googleCalendarEventIdsByEmail &&
            Object.keys(ev.googleCalendarEventIdsByEmail).length > 0)
        ) {
          await clearEventGoogleCalendarFields(supabase, caseId, ev.id);
        }
      }
      await updateCase(supabase, caseId, { status: "archived" });
      await logActivity(supabase, user.id, {
        caseId,
        caseName: display,
        action: "case_archived",
        description: `Archived case (Delete case) — removed ${removed} Google Calendar row(s); ${events.length} DocketFlow event(s) retained`,
        userEmail: user.email ?? "",
      });
      flash("Case archived — Google Calendar removed; deadlines kept in DocketFlow");
      router.push("/cases");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Could not archive case");
    } finally {
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
        updated = { ...updated, startDateTime: startIso, endDateTime: endIso };
      } else {
        updated = { ...updated, startDateTime: null, endDateTime: null };
        if (pickEndTime) {
          setMsg("Set a start time to use an end time, or clear end time for an all-day event.");
          setBusy(false);
          return;
        }
      }
      await saveEvent(supabase, caseId, updated);
      if (updated.googleEventId) {
        const res = await calendarApi({
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
          ...(updated.startDateTime ? { startDateTime: updated.startDateTime } : {}),
          ...(updated.endDateTime ? { endDateTime: updated.endDateTime } : {}),
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
        if (ev.googleEventId) {
          await calendarApi(calendarDeletePayload(ev), idToken);
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
      const supabase = getBrowserSupabase();
      const selectedEvents = events.filter((e) => selected.has(e.id));
      await bulkRescheduleEvents(supabase, caseId, [...selected], days);
      for (const ev of selectedEvents) {
        if (!ev.googleEventId) continue;
        const d = new Date(`${ev.date}T12:00:00`);
        d.setDate(d.getDate() + days);
        const newDate = d.toISOString().slice(0, 10);
        const res = await calendarApi({
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
          ...(ev.startDateTime ? { startDateTime: ev.startDateTime } : {}),
          ...(ev.endDateTime ? { endDateTime: ev.endDateTime } : {}),
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
    setBusy(true); setMsg(null);
    try {
      const supabase = getBrowserSupabase();
      const newContactIds = reassignIds.filter(Boolean);
      await updateCase(supabase, caseId, { assignedContactIds: newContactIds });
      const attendeeEmails = Array.from(
        new Set(
          newContactIds
            .map((id) => contacts.find((ct) => ct.id === id)?.email)
            .filter((e): e is string => Boolean(e))
        )
      );
      const withGoogle = events.filter(
        (ev) =>
          !ev.googleHostCalendarId &&
          (ev.googleEventId ||
            (ev.googleCalendarEventIdsByEmail &&
              Object.keys(ev.googleCalendarEventIdsByEmail).length > 0))
      );
      if (withGoogle.length > 0 && attendeeEmails.length > 0) {
        const res = await calendarApi(
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
              ...(ev.startDateTime ? { startDateTime: ev.startDateTime } : {}),
              ...(ev.endDateTime ? { endDateTime: ev.endDateTime } : {}),
              googleEventId: ev.googleEventId,
              googleCalendarEventIdsByEmail: ev.googleCalendarEventIdsByEmail,
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
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Reassign failed");
    } finally { setBusy(false); }
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
      {/* Breadcrumb + header */}
      <div className="mb-2">
        <Link href="/cases" className="text-xs font-medium text-text-muted hover:text-primary">← All Cases</Link>
      </div>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-text lg:text-3xl">{caseDisplayName(c)}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-text-muted">
            {c.name && c.name !== caseDisplayName(c) && <span>{c.name}</span>}
            {c.court && <><span className="text-border-strong">·</span><span>{c.court}</span></>}
            {c.dateOfIncident && (
              <>
                <span className="text-border-strong">·</span>
                <span>Incident {c.dateOfIncident}</span>
              </>
            )}
            <Badge variant={c.status === "active" ? "success" : "default"}>{c.status}</Badge>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {c.status === "archived" ? (
            <span
              className="inline-flex cursor-not-allowed items-center justify-center rounded-lg border border-border bg-surface-alt px-4 py-1.5 text-sm font-medium text-text-dim"
              title="Activate the case to import ASO/DCO deadlines"
            >
              Import ASO / DCO
            </span>
          ) : (
            <>
              <Link
                href={`/cases/${caseId}/import-aso`}
                className="inline-flex items-center justify-center rounded-lg border border-border bg-white px-4 py-1.5 text-sm font-medium text-text shadow-sm transition hover:bg-surface-alt"
              >
                Import ASO / DCO
              </Link>
              <Button variant="pink" size="sm" disabled={busy} onClick={() => openAddEventModal()}>
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
          {c.status === "archived" && (
            <Button variant="secondary" size="sm" disabled={busy} onClick={() => void setStatus("active")}>
              Mark active
            </Button>
          )}
          <Button
            variant="danger"
            size="sm"
            disabled={busy}
            className="max-w-[min(100%,280px)] whitespace-normal text-center leading-snug"
            onClick={() => void destroyCase()}
          >
            Archive case and Delete All Calendar Events
          </Button>
        </div>
      </div>

      {/* Assigned contacts */}
      <Card className="mt-6">
        <CardBody>
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-text">Assigned Contacts</h3>
            <Button variant="ghost" size="sm" onClick={() => { setShowReassign(!showReassign); setReassignIds([...c.assignedContactIds]); }}>
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
                return (
                  <span
                    key={`${id}-${idx}`}
                    className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface-alt px-3 py-1 text-xs font-medium text-text"
                  >
                    {ct ? ct.name : "Unknown contact"}
                    {ct && <Badge variant="default">{ct.role.replace("_", " ")}</Badge>}
                  </span>
                );
              })}
            </div>
          ) : (
            <div className="mt-3 space-y-3">
              {reassignIds.map((rid, i) => (
                <div key={i} className="flex items-center gap-2">
                  <Select value={rid} onChange={(e) => {
                    const next = [...reassignIds];
                    next[i] = e.target.value;
                    setReassignIds(next);
                  }}>
                    <option value="">Select contact…</option>
                    {contacts.map((ct) => (
                      <option key={ct.id} value={ct.id}>{ct.name} ({ct.role.replace("_", " ")})</option>
                    ))}
                  </Select>
                  <button type="button" className="text-danger hover:text-danger/80" onClick={() => setReassignIds(reassignIds.filter((_, j) => j !== i))}>
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                  </button>
                </div>
              ))}
              <div className="flex gap-2">
                <Button variant="ghost" size="sm" onClick={() => setReassignIds([...reassignIds, ""])}>+ Add contact</Button>
                <Button size="sm" disabled={busy} onClick={() => void saveReassign()}>Save</Button>
              </div>
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

      {/* Timeline */}
      <Card className="mt-6">
        <CardHeader>
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-text">Timeline · {events.length} events</h2>
            <button type="button" className="text-xs font-medium text-primary hover:underline" onClick={toggleAll}>
              {selected.size === events.length ? "Deselect all" : "Select all"}
            </button>
          </div>
        </CardHeader>
        <CardBody className="p-0">
          {events.length === 0 ? (
            <div className="px-6 py-10 text-center text-sm text-text-muted">No events on this case.</div>
          ) : (
            <div className="divide-y divide-border">
              {events.map((ev) => (
                <div key={ev.id} className={`flex gap-4 px-6 py-4 transition-colors ${selected.has(ev.id) ? "bg-primary/[0.04]" : ""}`}>
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
                      <span className="text-sm font-semibold tabular-nums text-text">{ev.date}</span>
                      {ev.startDateTime && (
                        <span className="text-xs font-medium text-text-secondary">
                          {new Date(ev.startDateTime).toLocaleString(undefined, {
                            month: "short",
                            day: "numeric",
                            year: "numeric",
                            hour: "numeric",
                            minute: "2-digit",
                          })}
                        </span>
                      )}
                      {ev.eventKind && (
                        <Badge variant="default">
                          {EVENT_KIND_LABELS[ev.eventKind ?? "other_event"]}
                        </Badge>
                      )}
                      <Badge variant={catBadge[ev.category]}>{ev.category}</Badge>
                      {ev.googleEventId && <Badge variant="success">Synced</Badge>}
                      {ev.noiseFlag && <Badge variant="warning">{ev.noiseReason ?? "Noise"}</Badge>}
                    </div>
                    <p className="mt-1 text-sm font-medium text-text">{ev.title}</p>
                    {ev.deponentOrSubject && (
                      <p className="mt-0.5 text-xs text-text-secondary">
                        <span className="font-medium text-text-muted">Deponent / subject:</span>{" "}
                        {ev.deponentOrSubject}
                      </p>
                    )}
                    {ev.description && <p className="mt-0.5 text-sm text-text-muted line-clamp-2">{ev.description}</p>}
                    {ev.externalAttendeesText && (
                      <p className="mt-0.5 text-xs text-text-dim line-clamp-1">
                        <span className="font-medium text-text-muted">Attendees:</span> {ev.externalAttendeesText}
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
                    <div className="mt-2 flex gap-3">
                      <button type="button" className="text-xs font-medium text-primary hover:underline" onClick={() => setEditing({ ...ev })}>Edit</button>
                      <button type="button" className="text-xs font-medium text-danger hover:underline" onClick={() => void removeEvent(ev)} disabled={busy}>Remove</button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardBody>
      </Card>

      {/* Add calendar event (depositions, calls, etc.) */}
      {showAddEvent && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
          <Card className="max-h-[min(90vh,880px)] w-full max-w-lg overflow-y-auto shadow-2xl">
            <CardHeader>
              <h3 className="text-base font-semibold text-text">Add calendar event</h3>
              <p className="mt-1 text-xs text-text-muted">
                Timed entries sync to Google Calendar with reminders; a Zoom or meet link is copied to the Location
                field when provided.
              </p>
            </CardHeader>
            <CardBody className="space-y-4">
              <div>
                <Label required>Event type</Label>
                <Select
                  className="mt-1.5"
                  value={addKind}
                  onChange={(e) => setAddKind(e.target.value as EventKind)}
                >
                  {MANUAL_EVENT_KIND_GROUPS.map((g) => (
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
                <Label>Title</Label>
                <Input
                  className="mt-1.5"
                  value={addTitle}
                  onChange={(e) => setAddTitle(e.target.value)}
                  placeholder={suggestedTitleForManualEvent(addKind, addDeponent)}
                />
                <p className="mt-1 text-xs text-text-dim">Leave blank to use the suggested title.</p>
              </div>
              <div>
                <Label required={manualEventNeedsDeponentField(addKind)}>
                  {manualEventNeedsDeponentField(addKind) ? "Who is being deposed" : "Subject or focus (optional)"}
                </Label>
                <Input
                  className="mt-1.5"
                  value={addDeponent}
                  onChange={(e) => setAddDeponent(e.target.value)}
                  placeholder={
                    manualEventNeedsDeponentField(addKind)
                      ? "Witness or deponent name"
                      : "e.g. opposing counsel, topic"
                  }
                />
              </div>
              <div>
                <Label required>Event date</Label>
                <Input
                  type="date"
                  className="mt-1.5"
                  value={addEventDate}
                  onChange={(e) => setAddEventDate(e.target.value)}
                />
                <p className="mt-1 text-xs text-text-dim">
                  Start and end times are always on this day (no separate start/end dates).
                </p>
              </div>
              <FiveMinuteTimeSelect
                label="Start time (optional)"
                value={addStartTime}
                onChange={(t) => {
                  setAddStartTime(t);
                  if (!t) setAddEndTime("");
                }}
                allowNoTime
                noTimeLabel="All day (no specific time)"
                hint="5-minute increments. All day creates a single calendar day block without a clock time."
              />
              <FiveMinuteTimeSelect
                label="End time (optional)"
                value={addEndTime}
                onChange={setAddEndTime}
                allowNoTime
                noTimeLabel="Default (+1 hour after start)"
                disabled={!addStartTime}
                hint={
                  addStartTime
                    ? "Same day as the event date. Leave as default for one hour after start."
                    : "Set a start time first if you need an end time."
                }
              />
              <div>
                <Label>Zoom / video link</Label>
                <Input
                  className="mt-1.5"
                  type="url"
                  inputMode="url"
                  value={addZoom}
                  onChange={(e) => setAddZoom(e.target.value)}
                  placeholder="https://…"
                />
                <p className="mt-1 text-xs text-text-muted">
                  Stored on the case and pushed to Google Calendar as Location so it is easy to find on phones.
                </p>
              </div>
              <div>
                <Label>External attendees / parties</Label>
                <Textarea
                  rows={2}
                  className="mt-1.5"
                  value={addExternal}
                  onChange={(e) => setAddExternal(e.target.value)}
                  placeholder="Court reporter, opposing counsel, court reporter email, etc."
                />
              </div>
              <div>
                <Label>Internal notes</Label>
                <Textarea
                  rows={3}
                  className="mt-1.5"
                  value={addNotes}
                  onChange={(e) => setAddNotes(e.target.value)}
                  placeholder="Prep checklist, room details, dial-in, etc."
                />
              </div>
              <div className="rounded-lg border border-border bg-surface-alt/60 px-4 py-3">
                <Label>Google Calendar invite</Label>
                <p className="mt-1 text-xs text-text-muted">
                  Everyone assigned to the case below is included automatically. Add others from your contacts using
                  the dropdowns (each person needs an email on their contact).
                </p>
                <p className="mt-2 text-xs font-semibold uppercase tracking-wide text-text-dim">On this invite</p>
                <ul className="mt-1.5 space-y-1 text-sm text-text">
                  {c.assignedContactIds.length === 0 && (
                    <li className="text-text-muted">No contacts assigned on this case.</li>
                  )}
                  {c.assignedContactIds.map((id) => {
                    const ct = contacts.find((x) => x.id === id);
                    return (
                      <li key={id}>
                        {ct ? (
                          <>
                            <span className="font-medium">{ct.name}</span>
                            <span className="text-text-muted"> ({ct.role.replace("_", " ")})</span>
                            {ct.email?.trim() ? (
                              <span className="text-text-dim"> · {ct.email}</span>
                            ) : (
                              <span className="text-warning"> · no email — not on calendar invite</span>
                            )}
                          </>
                        ) : (
                          <span className="text-text-muted">Unknown contact</span>
                        )}
                      </li>
                    );
                  })}
                </ul>
                <div className="mt-3 flex items-center justify-between gap-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-text-dim">
                    Add more people (optional)
                  </p>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="shrink-0"
                    onClick={() => setAddExtraInviteeRowIds((prev) => [...prev, ""])}
                  >
                    + Add person
                  </Button>
                </div>
                <div className="mt-2 space-y-2">
                  {addExtraInviteeRowIds.length === 0 && (
                    <p className="text-xs text-text-dim">Use “+ Add person” to invite someone not already on this case.</p>
                  )}
                  {addExtraInviteeRowIds.map((rowId, idx) => {
                    const onCase = new Set(c.assignedContactIds);
                    const takenElsewhere = new Set(
                      addExtraInviteeRowIds.filter((id, i) => i !== idx && id).map((id) => id)
                    );
                    const rowOptions = contacts
                      .filter((ct) => Boolean(ct.email?.trim()) && !onCase.has(ct.id))
                      .filter((ct) => !takenElsewhere.has(ct.id) || ct.id === rowId)
                      .sort((a, b) => a.name.localeCompare(b.name));
                    return (
                      <div key={idx} className="flex items-center gap-2">
                        <Select
                          className="min-w-0 flex-1"
                          value={rowId}
                          onChange={(e) => {
                            const v = e.target.value;
                            setAddExtraInviteeRowIds((prev) => {
                              const next = [...prev];
                              next[idx] = v;
                              return next;
                            });
                          }}
                        >
                          <option value="">Select contact…</option>
                          {rowOptions.map((ct) => (
                            <option key={ct.id} value={ct.id}>
                              {ct.name} ({ct.role.replace("_", " ")})
                            </option>
                          ))}
                        </Select>
                        <button
                          type="button"
                          className="shrink-0 text-danger hover:text-danger/80"
                          aria-label="Remove"
                          onClick={() =>
                            setAddExtraInviteeRowIds((prev) => prev.filter((_, j) => j !== idx))
                          }
                        >
                          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </div>
                    );
                  })}
                </div>
                {!contacts.some(
                  (ct) => Boolean(ct.email?.trim()) && !c.assignedContactIds.includes(ct.id)
                ) && (
                  <p className="mt-2 text-xs text-text-dim">
                    {contacts.some((ct) => Boolean(ct.email?.trim()))
                      ? "Everyone with an email is already on this case. Add another contact under Contacts to invite them here."
                      : "Add contacts with email addresses under Contacts to invite them on calendar events."}
                  </p>
                )}
              </div>
              <ReminderMinutesEditor value={addReminders} onChange={setAddReminders} />
              <div className="flex justify-end gap-3 pt-2">
                <Button variant="ghost" onClick={() => setShowAddEvent(false)}>Cancel</Button>
                <Button variant="pink" disabled={busy} onClick={() => void saveNewCalendarEvent()}>
                  {busy ? "Saving…" : "Save & sync"}
                </Button>
              </div>
            </CardBody>
          </Card>
        </div>
      )}

      {/* Edit modal */}
      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
          <Card className="max-h-[min(90vh,880px)] w-full max-w-lg overflow-y-auto shadow-2xl">
            <CardHeader><h3 className="text-base font-semibold text-text">Edit Event</h3></CardHeader>
            <CardBody className="space-y-4">
              <div>
                <Label>Event type</Label>
                <Select
                  className="mt-1.5"
                  value={editing.eventKind ?? "other_event"}
                  onChange={(e) => setEditing({ ...editing, eventKind: e.target.value as EventKind })}
                >
                  {ALL_EVENT_KIND_SELECT_GROUPS.map((g) => (
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
                <Input
                  type="date"
                  className="mt-1.5"
                  value={editing.date}
                  onChange={(e) => setEditing({ ...editing, date: e.target.value })}
                />
                <p className="mt-1 text-xs text-text-dim">
                  Times below apply only to this day.
                </p>
              </div>
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
                    : "Set a start time first."
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
              <ReminderMinutesEditor
                value={editing.remindersMinutes}
                onChange={(minutes) => setEditing({ ...editing, remindersMinutes: minutes })}
              />
              <div className="flex justify-end gap-3 pt-2">
                <Button variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
                <Button disabled={busy} onClick={() => void saveEdit()}>Save Changes</Button>
              </div>
            </CardBody>
          </Card>
        </div>
      )}
    </PageWrapper>
  );
}
