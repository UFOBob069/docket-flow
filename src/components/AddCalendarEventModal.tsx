"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { caseDisplayName } from "@/lib/case-display";
import { googleCalendarDescription } from "@/lib/calendar-payload";
import { postCalendarSync } from "@/lib/calendar-client";
import { createAdHocCalendarEvent } from "@/lib/event-factory";
import {
  CASE_EVENT_KIND_SECTIONS,
  DEFAULT_CASE_EVENT_KIND,
  getFixedRemindersForKind,
} from "@/lib/case-event-kinds";
import {
  categoryForManualEventKind,
  manualEventNeedsDeponentField,
  suggestedTitleForManualEvent,
} from "@/lib/one-off-events";
import {
  mergeAttendeeEmailLists,
  parseOneOffInviteEmails,
} from "@/lib/calendar-global-recipients";
import { logActivity, saveEvent } from "@/lib/supabase/repo";
import { getBrowserSupabase } from "@/lib/supabase/singleton";
import type { Case, Contact, EventKind, EventScheduleKind } from "@/lib/types";
import { FixedRemindersReadout } from "@/components/FixedRemindersReadout";
import { FiveMinuteTimeSelect } from "@/components/FiveMinuteTimeSelect";
import { GoogleCalendarInviteColorPicker } from "@/components/GoogleCalendarInviteColorPicker";
import { formatReminderMinutesList } from "@/lib/reminder-presets";
import { normalizeGoogleCalendarInviteColorId } from "@/lib/google-calendar-invite-colors";
import {
  addMinutesToLocalClock,
  defaultLocalStartParts,
  formatTimeOptionLabel,
  isEndTimeAfterStartTime,
  isoToLocalDateTimeParts,
  localDateTimePartsToIso,
} from "@/lib/five-minute-datetime";
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  Input,
  Label,
  Select,
  Textarea,
} from "@/components/ui";

export type AddCalendarEventModalProps = {
  open: boolean;
  onClose: () => void;
  contacts: Contact[];
  idToken: string | null;
  user: { id: string; email?: string | null };
  lockedCase: Case | null;
  casePickerOptions: Case[];
  onSaved?: (info: { title: string }) => void;
};

type WizardPhase = "case" | "section" | "kind" | "details";

function getWizardPhase(step: number, needCaseStep: boolean): WizardPhase {
  if (needCaseStep) {
    if (step === 0) return "case";
    if (step === 1) return "section";
    if (step === 2) return "kind";
    return "details";
  }
  if (step === 0) return "section";
  if (step === 1) return "kind";
  return "details";
}

export function AddCalendarEventModal({
  open,
  onClose,
  contacts,
  idToken,
  user,
  lockedCase,
  casePickerOptions,
  onSaved,
}: AddCalendarEventModalProps) {
  const router = useRouter();
  const [wizardStep, setWizardStep] = useState(0);
  const [selectedCaseId, setSelectedCaseId] = useState("");
  const [caseQuery, setCaseQuery] = useState("");
  const [selectedSectionId, setSelectedSectionId] = useState(CASE_EVENT_KIND_SECTIONS[0]!.id);
  const [addKind, setAddKind] = useState<EventKind>(DEFAULT_CASE_EVENT_KIND);
  const [addTitle, setAddTitle] = useState("");
  const [addDeponent, setAddDeponent] = useState("");
  const [addEventDate, setAddEventDate] = useState("");
  const [addStartTime, setAddStartTime] = useState("");
  const [addEndTime, setAddEndTime] = useState("");
  const [addZoom, setAddZoom] = useState("");
  const [addExternal, setAddExternal] = useState("");
  const [addNotes, setAddNotes] = useState("");
  const [addExtraInviteeRowIds, setAddExtraInviteeRowIds] = useState<string[]>([]);
  const [addOneTimeInviteEmails, setAddOneTimeInviteEmails] = useState("");
  const [scheduleKind, setScheduleKind] = useState<EventScheduleKind>("deadline");
  const [meetingDurationMin, setMeetingDurationMin] = useState(60);
  const [addGoogleColorId, setAddGoogleColorId] = useState<string | null>(null);
  const [openSlotsLoading, setOpenSlotsLoading] = useState(false);
  const [openSlotStarts, setOpenSlotStarts] = useState<string[] | null>(null);
  const [openSlotWarnings, setOpenSlotWarnings] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const pickerKey = casePickerOptions.map((c) => c.id).join("|");
  const needCaseStep = !lockedCase && casePickerOptions.length > 0;
  const lastStep = needCaseStep ? 3 : 2;
  const phase = getWizardPhase(wizardStep, needCaseStep);
  const stepLabel = `${wizardStep + 1} / ${lastStep + 1}`;

  const selectedSection = useMemo(
    () => CASE_EVENT_KIND_SECTIONS.find((s) => s.id === selectedSectionId) ?? CASE_EVENT_KIND_SECTIONS[0]!,
    [selectedSectionId]
  );

  useEffect(() => {
    if (!open) return;
    const { date } = defaultLocalStartParts();
    const firstSec = CASE_EVENT_KIND_SECTIONS[0]!;
    setWizardStep(0);
    setSelectedSectionId(firstSec.id);
    setAddKind(firstSec.kinds[0]!.value);
    setAddTitle("");
    setAddDeponent("");
    setAddEventDate(date);
    /** All-day by default (day row at top of calendar); user can set start/end times if needed. */
    setAddStartTime("");
    setAddEndTime("");
    setAddZoom("");
    setAddExternal("");
    setAddNotes("");
    setAddExtraInviteeRowIds([]);
    setAddOneTimeInviteEmails("");
    setScheduleKind("deadline");
    setMeetingDurationMin(60);
    setAddGoogleColorId(null);
    setOpenSlotStarts(null);
    setOpenSlotWarnings(null);
    setMsg(null);
    if (!lockedCase && casePickerOptions.length) {
      setSelectedCaseId(casePickerOptions[0]!.id);
    }
    setCaseQuery("");
  }, [open, lockedCase?.id, pickerKey]);

  useEffect(() => {
    setOpenSlotStarts(null);
    setOpenSlotWarnings(null);
  }, [addEventDate, scheduleKind, meetingDurationMin]);

  const effectiveCase =
    lockedCase ?? casePickerOptions.find((c) => c.id === selectedCaseId) ?? null;

  const firmWideContacts = useMemo(
    () => contacts.filter((ct) => ct.teamCalendarScope === "all_firm_events" && ct.email?.trim()),
    [contacts]
  );

  const firmWideEmails = useMemo(
    () => firmWideContacts.map((ct) => ct.email.trim().toLowerCase()),
    [firmWideContacts]
  );

  const fixedReminders = useMemo(() => getFixedRemindersForKind(addKind), [addKind]);

  const filteredCaseOptions = useMemo(() => {
    const q = caseQuery.trim().toLowerCase();
    if (!q) return casePickerOptions;
    return casePickerOptions.filter((c) => {
      const hay = [
        caseDisplayName(c),
        c.clientName ?? "",
        c.caseNumber ?? "",
        c.causeNumber ?? "",
      ]
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [casePickerOptions, caseQuery]);

  async function saveNewCalendarEvent() {
    const caseRecord = effectiveCase;
    if (!caseRecord || !user?.id || !idToken) return;
    const caseId = caseRecord.id;
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
    if (scheduleKind === "meeting" && !addStartTime.trim()) {
      setMsg("Meetings need a start time on the event date (internal, time-based).");
      return;
    }
    const oneOffParsed = parseOneOffInviteEmails(addOneTimeInviteEmails);
    if (!oneOffParsed.ok) {
      setMsg(oneOffParsed.error);
      return;
    }
    const oneTimeEmails = oneOffParsed.emails;
    if (addStartTime) {
      const startIso = localDateTimePartsToIso(addEventDate, addStartTime);
      if (Number.isNaN(new Date(startIso).getTime())) {
        setMsg("Invalid start time.");
        return;
      }
    }
    const title = addTitle.trim() || suggestedTitleForManualEvent(addKind, addDeponent);
    const cat = categoryForManualEventKind(addKind);
    const remindersMinutes = getFixedRemindersForKind(addKind);

    setBusy(true);
    setMsg(null);
    try {
      const supabase = getBrowserSupabase();
      const displayName = caseDisplayName(caseRecord);
      const inviteContactIds = [
        ...new Set([...caseRecord.assignedContactIds, ...addExtraInviteeRowIds.filter(Boolean)]),
      ];
      const assigneeEmails = Array.from(
        new Set(
          inviteContactIds
            .map((id) => contacts.find((ct) => ct.id === id)?.email)
            .filter((e): e is string => Boolean(e?.trim()))
            .map((e) => e.trim().toLowerCase())
        )
      );
      const attendeeEmailsForSync = mergeAttendeeEmailLists(assigneeEmails, oneTimeEmails);
      const mergedRecipients = mergeAttendeeEmailLists(
        assigneeEmails,
        firmWideEmails,
        oneTimeEmails
      );
      if (mergedRecipients.length === 0) {
        setMsg(
          "No calendar recipients: assign contacts with email on the case, add saved invitees below, enter one-time emails, or set a contact to “all firm events” under Contacts."
        );
        setBusy(false);
        return;
      }

      const externalWithOneTime =
        addExternal.trim() || oneTimeEmails.length
          ? [
              addExternal.trim(),
              oneTimeEmails.length
                ? `One-time calendar invitees: ${oneTimeEmails.join(", ")}`
                : "",
            ]
              .filter(Boolean)
              .join("\n\n")
          : null;

      const draft = createAdHocCalendarEvent(caseId, user.id, {
        eventDate: addEventDate,
        startTime: addStartTime || null,
        endTime: addStartTime && addEndTime ? addEndTime : null,
        eventKind: addKind,
        title,
        description: addNotes.trim(),
        category: cat,
        deponentOrSubject: addDeponent.trim() || null,
        externalAttendeesText: externalWithOneTime,
        zoomLink: addZoom.trim() || null,
        remindersMinutes,
        scheduleKind,
        createdByEmail: user.email?.trim() ?? null,
        googleColorId: addGoogleColorId,
      });

      await saveEvent(supabase, caseId, draft);

      const calDesc = googleCalendarDescription(draft);
      const syncGc = normalizeGoogleCalendarInviteColorId(draft.googleColorId ?? undefined);
      const calRes = await postCalendarSync(
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
              scheduleKind: draft.scheduleKind,
              ...(draft.zoomLink?.trim() ? { location: draft.zoomLink.trim() } : {}),
              ...(syncGc != null
                ? { googleColorId: syncGc }
                : draft.googleColorId === null
                  ? { googleColorId: null }
                  : {}),
            },
          ],
          attendeeEmails: attendeeEmailsForSync,
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

      onClose();
      onSaved?.({ title: saved.title });
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Could not add event");
    } finally {
      setBusy(false);
    }
  }

  function goNext() {
    if (phase === "case" && !selectedCaseId) return;
    if (wizardStep < lastStep) setWizardStep((s) => s + 1);
  }

  function goBack() {
    if (wizardStep > 0) setWizardStep((s) => s - 1);
  }

  async function fetchOpenMeetingSlots() {
    const caseRecord = effectiveCase;
    if (!caseRecord || !idToken || scheduleKind !== "meeting") return;
    if (!addEventDate.trim()) {
      setMsg("Pick an event date first.");
      return;
    }
    const oneOffParsed = parseOneOffInviteEmails(addOneTimeInviteEmails);
    if (!oneOffParsed.ok) {
      setMsg(oneOffParsed.error);
      return;
    }
    const inviteContactIds = [
      ...new Set([...caseRecord.assignedContactIds, ...addExtraInviteeRowIds.filter(Boolean)]),
    ];
    const assigneeEmails = Array.from(
      new Set(
        inviteContactIds
          .map((id) => contacts.find((ct) => ct.id === id)?.email)
          .filter((e): e is string => Boolean(e?.trim()))
          .map((e) => e.trim().toLowerCase())
      )
    );
    const attendeeEmails = mergeAttendeeEmailLists(assigneeEmails, oneOffParsed.emails);
    if (attendeeEmails.length === 0) {
      setMsg(
        "Add at least one email to check: assign contacts on the case, add one-time invites, or use firm-wide calendar contacts."
      );
      return;
    }

    setOpenSlotsLoading(true);
    setMsg(null);
    try {
      const timeMin = localDateTimePartsToIso(addEventDate, "09:00");
      const timeMax = localDateTimePartsToIso(addEventDate, "17:00");
      const res = await fetch("/api/calendar/freebusy", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${idToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          timeMin,
          timeMax,
          durationMinutes: meetingDurationMin,
          attendeeEmails,
        }),
      });
      const json = (await res.json()) as {
        slotStartIsoCandidates?: string[];
        calendarWarnings?: string[];
        error?: string;
      };
      if (!res.ok) throw new Error(json.error ?? "Could not load open times");
      setOpenSlotStarts(json.slotStartIsoCandidates ?? []);
      setOpenSlotWarnings(json.calendarWarnings?.length ? json.calendarWarnings : null);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Could not load open times");
      setOpenSlotStarts(null);
      setOpenSlotWarnings(null);
    } finally {
      setOpenSlotsLoading(false);
    }
  }

  if (!open) return null;

  const c = effectiveCase;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
      <Card className="max-h-[min(90vh,880px)] w-full max-w-lg overflow-y-auto shadow-2xl">
        <CardHeader>
          <div className="flex items-start justify-between gap-2">
            <div>
              <h3 className="text-base font-semibold text-text">Add calendar event</h3>
              <p className="mt-1 text-xs text-text-muted">
                {phase === "details"
                  ? scheduleKind === "meeting"
                    ? `Step ${stepLabel} · Meeting — pick start (and optional end) time on the event date.`
                    : `Step ${stepLabel} · Deadline — all-day by default; add times only if this date has a specific time.`
                  : `Step ${stepLabel} · Choose the event type, then date and details on the last step.`}{" "}
                Reminders follow the taxonomy type.
              </p>
            </div>
          </div>
        </CardHeader>
        <CardBody className="space-y-4">
          {phase === "case" && needCaseStep && (
            <>
              <div>
                <Label required>Case</Label>
                <Input
                  className="mt-1.5"
                  value={caseQuery}
                  onChange={(e) => setCaseQuery(e.target.value)}
                  placeholder="Type case name or number..."
                />
                <div className="mt-2 max-h-64 overflow-y-auto rounded-lg border border-border bg-white p-1">
                  {filteredCaseOptions.map((k) => (
                    <button
                      key={k.id}
                      type="button"
                      onClick={() => setSelectedCaseId(k.id)}
                      className={`w-full rounded-md px-2 py-2 text-left text-sm transition ${
                        selectedCaseId === k.id
                          ? "bg-primary-light text-primary"
                          : "text-text hover:bg-surface-alt"
                      }`}
                    >
                      {caseDisplayName(k)}
                    </button>
                  ))}
                  {filteredCaseOptions.length === 0 && (
                    <p className="px-2 py-2 text-xs text-text-dim">No matching cases.</p>
                  )}
                </div>
              </div>
              {!selectedCaseId && (
                <p className="text-sm text-text-muted">Select a case to continue.</p>
              )}
            </>
          )}

          {phase === "section" && (
            <>
              <Label required>Category</Label>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                {CASE_EVENT_KIND_SECTIONS.map((sec) => (
                  <button
                    key={sec.id}
                    type="button"
                    onClick={() => {
                      setSelectedSectionId(sec.id);
                      setAddKind(sec.kinds[0]!.value);
                    }}
                    className={`rounded-lg border px-3 py-2.5 text-left text-sm font-medium transition ${
                      selectedSectionId === sec.id
                        ? "border-primary bg-primary-light text-primary"
                        : "border-border bg-white text-text hover:bg-surface-alt"
                    }`}
                  >
                    {sec.title}
                  </button>
                ))}
              </div>
              <div className="mt-4 border-t border-border pt-4">
                <p className="text-xs text-text-muted">
                  Prefer to extract deadlines from a scheduling order or similar file?
                </p>
                <Button
                  type="button"
                  variant="secondary"
                  className="mt-2"
                  disabled={!effectiveCase || effectiveCase.status === "archived"}
                  title={
                    effectiveCase?.status === "archived"
                      ? "Activate the case to import dates from a document"
                      : !effectiveCase
                        ? "Select a case first"
                        : undefined
                  }
                  onClick={() => {
                    if (!effectiveCase || effectiveCase.status === "archived") return;
                    onClose();
                    router.push(`/cases/${effectiveCase.id}/import-aso`);
                  }}
                >
                  Import document with dates
                </Button>
              </div>
            </>
          )}

          {phase === "kind" && (
            <>
              <p className="text-xs text-text-muted">
                Category: <span className="font-medium text-text">{selectedSection.title}</span>
              </p>
              <Label required>Event type</Label>
              <div className="mt-2 max-h-[min(40vh,320px)] space-y-2 overflow-y-auto pr-1">
                {selectedSection.kinds.map((k) => (
                  <button
                    key={k.value}
                    type="button"
                    onClick={() => setAddKind(k.value)}
                    className={`flex w-full flex-col gap-1 rounded-lg border px-3 py-2.5 text-left text-sm transition ${
                      addKind === k.value
                        ? "border-primary bg-primary-light text-primary"
                        : "border-border bg-white text-text hover:bg-surface-alt"
                    }`}
                  >
                    <span className="font-medium">{k.label}</span>
                    <span className="text-[11px] font-normal text-text-muted">
                      Reminders: {formatReminderMinutesList(k.remindersMinutes)}
                    </span>
                  </button>
                ))}
              </div>
            </>
          )}

          {phase === "details" && c && (
            <>
              <div>
                <Label required>This event is a</Label>
                <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <button
                    type="button"
                    onClick={() => {
                      setScheduleKind("deadline");
                      setAddStartTime("");
                      setAddEndTime("");
                    }}
                    className={`rounded-xl border-2 px-4 py-3 text-left transition ${
                      scheduleKind === "deadline"
                        ? "border-warning/60 bg-warning-light/50 shadow-sm"
                        : "border-border bg-white hover:bg-surface-alt"
                    }`}
                  >
                    <span className="text-lg" aria-hidden>
                      ⏰
                    </span>
                    <span className="ml-2 text-sm font-semibold text-text">Deadline</span>
                    <p className="mt-1 text-xs text-text-muted">
                      Docket / court date. All-day by default (whole day at the top of the calendar).
                    </p>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setScheduleKind("meeting");
                      setAddStartTime((s) => s || "09:00");
                      setAddEndTime((e) => e || "10:00");
                    }}
                    className={`rounded-xl border-2 px-4 py-3 text-left transition ${
                      scheduleKind === "meeting"
                        ? "border-primary/40 bg-primary-light/40 shadow-sm"
                        : "border-border bg-white hover:bg-surface-alt"
                    }`}
                  >
                    <span className="text-lg" aria-hidden>
                      📅
                    </span>
                    <span className="ml-2 text-sm font-semibold text-text">Meeting</span>
                    <p className="mt-1 text-xs text-text-muted">
                      Internal time-based block — start time required; end time optional (+1 hour default).
                    </p>
                  </button>
                </div>
              </div>
              <div className="rounded-lg border border-border bg-surface-alt/40 px-3 py-2 text-sm">
                <span className="text-text-muted">Type: </span>
                <span className="font-medium text-text">
                  {selectedSection.kinds.find((x) => x.value === addKind)?.label ?? addKind}
                </span>
              </div>
              <FixedRemindersReadout minutes={fixedReminders} />
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
                  {scheduleKind === "deadline" ? (
                    <>
                      Defaults to an <span className="font-medium text-text-secondary">all-day</span> deadline (whole
                      day). Add start/end only if this obligation has a specific time on this date.
                    </>
                  ) : (
                    <>
                      Meeting times are always on this calendar day — use start (required) and end for the internal
                      block.
                    </>
                  )}
                </p>
              </div>
              {scheduleKind === "meeting" && (
                <div className="rounded-lg border border-border bg-primary-light/20 px-3 py-3">
                  <Label>Meeting length (minutes)</Label>
                  <Input
                    type="number"
                    className="mt-1.5 max-w-32"
                    min={15}
                    max={480}
                    step={15}
                    value={meetingDurationMin}
                    onChange={(e) => {
                      const n = parseInt(e.target.value, 10);
                      if (Number.isNaN(n)) return;
                      const snapped = Math.round(n / 15) * 15;
                      setMeetingDurationMin(Math.min(480, Math.max(15, snapped)));
                    }}
                  />
                  <p className="mt-1 text-xs text-text-muted">
                    Meeting length uses 15-minute steps. Open-time suggestions use Google Calendar Free/Busy on the
                    event date, only between 9:00 AM and 5:00 PM in your local time, on the hour and half hour (:00 and
                    :30).
                  </p>
                  <Button
                    type="button"
                    variant="secondary"
                    className="mt-2"
                    disabled={openSlotsLoading || !idToken}
                    onClick={() => void fetchOpenMeetingSlots()}
                  >
                    {openSlotsLoading ? "Checking…" : "Suggest open times"}
                  </Button>
                  {openSlotStarts && (
                    <div className="mt-3">
                      <p className="text-xs font-medium text-text">
                        {openSlotStarts.length === 0
                          ? "No fully open slots in that window for this length."
                          : "Tap a start time:"}
                      </p>
                      {openSlotStarts.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-2">
                          {openSlotStarts.map((iso) => {
                            const { time } = isoToLocalDateTimeParts(iso);
                            if (!time) return null;
                            return (
                              <button
                                key={iso}
                                type="button"
                                className="rounded-full border border-primary/40 bg-white px-3 py-1 text-sm font-medium text-primary shadow-sm hover:bg-primary-light/60"
                                onClick={() => {
                                  setAddStartTime(time);
                                  setAddEndTime(
                                    addMinutesToLocalClock(addEventDate, time, meetingDurationMin)
                                  );
                                }}
                              >
                                {formatTimeOptionLabel(time)}
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}
                  {openSlotWarnings && openSlotWarnings.length > 0 && (
                    <p className="mt-2 text-xs text-warning">
                      Some calendars could not be read (treated as busy): {openSlotWarnings.join(" · ")}
                    </p>
                  )}
                </div>
              )}
              <FiveMinuteTimeSelect
                label={scheduleKind === "meeting" ? "Start time (required)" : "Start time (optional)"}
                value={addStartTime}
                onChange={(t) => {
                  setAddStartTime(t);
                  if (!t) setAddEndTime("");
                }}
                allowNoTime={scheduleKind !== "meeting"}
                required={scheduleKind === "meeting"}
                noTimeLabel="All day (no specific time)"
                hint={
                  scheduleKind === "meeting"
                    ? "Pick when the internal meeting begins (5-minute increments)."
                    : "5-minute increments. Leave blank for an all-day deadline."
                }
              />
              <FiveMinuteTimeSelect
                label="End time (optional)"
                value={addEndTime}
                onChange={setAddEndTime}
                allowNoTime
                noTimeLabel={
                  addStartTime ? "Default (+1 hour after start)" : "All-day — no end time"
                }
                disabled={!addStartTime}
                hint={
                  addStartTime
                    ? "Same day as the event date. Leave as default for one hour after start."
                    : scheduleKind === "meeting"
                      ? "Set a start time first."
                      : "End time does not apply while the event is all-day."
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
                  Case assignees, optional saved contacts, and one-time email addresses below get a copy. People set to{" "}
                  <span className="font-medium text-text-secondary">all firm events</span> under Contacts are merged
                  automatically by the server (shown here so you can see the full list).
                </p>
                <div className="mt-3">
                  <GoogleCalendarInviteColorPicker
                    value={addGoogleColorId}
                    onChange={setAddGoogleColorId}
                  />
                </div>
                <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-text-dim">Case assignees</p>
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
                            {ct.teamCalendarScope === "all_firm_events" && (
                              <span className="text-text-dim"> · firm-wide calendar</span>
                            )}
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
                <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-text-dim">
                  Also on invite (all firm calendar events)
                </p>
                <ul className="mt-1.5 space-y-1 text-sm text-text">
                  {firmWideContacts.filter((ct) => !c.assignedContactIds.includes(ct.id)).length === 0 ? (
                    <li className="text-text-muted">
                      {firmWideContacts.some((ct) => c.assignedContactIds.includes(ct.id))
                        ? "Everyone with firm-wide calendar is already listed under assignees above."
                        : "No extra contacts — add or flag people under Contacts."}
                    </li>
                  ) : (
                    firmWideContacts
                      .filter((ct) => !c.assignedContactIds.includes(ct.id))
                      .map((ct) => (
                        <li key={ct.id}>
                          <span className="font-medium">{ct.name}</span>
                          <span className="text-text-muted"> ({ct.role.replace("_", " ")})</span>
                          <span className="text-text-dim"> · {ct.email}</span>
                        </li>
                      ))
                  )}
                </ul>
                <div className="mt-3">
                  <Label>One-time email invites (optional)</Label>
                  <Textarea
                    rows={2}
                    className="mt-1.5 font-mono text-sm"
                    value={addOneTimeInviteEmails}
                    onChange={(e) => setAddOneTimeInviteEmails(e.target.value)}
                    placeholder={
                      "opposing@example.com, reporter@agency.com\n(one per line or comma-separated — not saved as contacts)"
                    }
                  />
                  <p className="mt-1 text-xs text-text-muted">
                    Same Google Calendar treatment as your team. For addresses you do not want in the firm contact list.
                  </p>
                </div>
                <div className="mt-3 flex items-center justify-between gap-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-text-dim">
                    Add more people from Contacts (optional)
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
                    <p className="text-xs text-text-dim">
                      Pick a saved contact not already on this case, or use one-time emails above.
                    </p>
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
            </>
          )}

          {phase === "details" && !c && (
            <p className="text-sm text-text-muted">Select a case in the previous steps.</p>
          )}

          {msg && <p className="text-sm text-danger">{msg}</p>}

          <div className="flex flex-wrap justify-end gap-2 border-t border-border pt-4">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            {wizardStep > 0 && (
              <Button variant="secondary" type="button" onClick={goBack}>
                Back
              </Button>
            )}
            {phase !== "details" && (
              <Button
                variant="pink"
                type="button"
                disabled={needCaseStep && phase === "case" && !selectedCaseId}
                onClick={goNext}
              >
                Continue
              </Button>
            )}
            {phase === "details" && c && (
              <Button variant="pink" disabled={busy} onClick={() => void saveNewCalendarEvent()}>
                {busy ? "Saving…" : "Save & sync"}
              </Button>
            )}
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
