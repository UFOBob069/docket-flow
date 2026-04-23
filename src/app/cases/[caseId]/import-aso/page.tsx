"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { getBrowserSupabase } from "@/lib/supabase/singleton";
import { buildCalendarBatches } from "@/lib/calendar-payload";
import { getRemindersForEventKind } from "@/lib/case-event-kinds";
import { extractedToCalendarEvents } from "@/lib/deadline-processing";
import { caseDisplayName } from "@/lib/case-display";
import { ALL_EVENT_KIND_SELECT_GROUPS, categoryForManualEventKind } from "@/lib/one-off-events";
import {
  logActivity,
  saveEvent,
  setEventsForCase,
  subscribeCase,
  subscribeContacts,
  updateCase,
} from "@/lib/supabase/repo";
import type {
  CalendarEvent,
  Case,
  Contact,
  EventCategory,
  EventKind,
  ExtractedDeadline,
} from "@/lib/types";
import { FixedRemindersReadout } from "@/components/FixedRemindersReadout";
import { PageSkeleton } from "@/components/PageSkeleton";
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
  Spinner,
  Textarea,
} from "@/components/ui";

const catBadge: Record<EventCategory, "trial" | "discovery" | "motions" | "pretrial" | "mediation" | "experts" | "other"> = {
  trial: "trial", discovery: "discovery", motions: "motions", pretrial: "pretrial",
  mediation: "mediation", experts: "experts", other: "other",
};

const stepLabels = ["Document", "Review", "Assign", "Confirm"];

export default function ImportAsoPage() {
  const router = useRouter();
  const params = useParams();
  const caseId = typeof params?.caseId === "string" ? params.caseId : "";
  const hydrated = useHydrated();
  const { user, loading, idToken, supabaseReady } = useAuth();
  const [step, setStep] = useState(0);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [caseRecord, setCaseRecord] = useState<Case | null>(null);
  const [caseResolved, setCaseResolved] = useState(false);

  const [name, setName] = useState("");
  const [clientName, setClientName] = useState("");
  const [causeNumber, setCauseNumber] = useState("");
  const [court, setCourt] = useState("");

  const [file, setFile] = useState<File | null>(null);
  const [extracting, setExtracting] = useState(false);
  const [events, setEvents] = useState<CalendarEvent[]>([]);

  const [attorneyId, setAttorneyId] = useState("");
  const [paralegalId, setParalegalId] = useState("");
  const [legalAssistantId, setLegalAssistantId] = useState("");
  const [otherId, setOtherId] = useState("");
  const [extraContactIds, setExtraContactIds] = useState<string[]>([]);

  const [busy, setBusy] = useState(false);
  const [progressMsg, setProgressMsg] = useState<string | null>(null);
  const [progressPct, setProgressPct] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const [datesValidatedConfirmed, setDatesValidatedConfirmed] = useState(false);

  useEffect(() => {
    if (step !== 3) setDatesValidatedConfirmed(false);
  }, [step]);

  useEffect(() => {
    if (!supabaseReady || loading || !user) return;
    const supabase = getBrowserSupabase();
    return subscribeContacts(supabase, user.id, setContacts);
  }, [user, loading, supabaseReady]);

  useEffect(() => {
    if (!supabaseReady || loading || !user || !caseId) return;
    const supabase = getBrowserSupabase();
    return subscribeCase(supabase, caseId, (c) => {
      setCaseRecord(c);
      setCaseResolved(true);
    });
  }, [user, loading, supabaseReady, caseId]);

  useEffect(() => {
    if (!caseRecord) return;
    setName(caseRecord.name ?? "");
    setClientName(caseRecord.clientName ?? "");
    setCauseNumber(caseRecord.caseNumber ?? caseRecord.causeNumber ?? "");
    setCourt(caseRecord.court ?? "");
    const a = caseRecord.assignedContactIds ?? [];
    if (a[0]) setAttorneyId(a[0]);
    if (a[1]) setParalegalId(a[1]);
    if (a[2]) setLegalAssistantId(a[2]);
    else setLegalAssistantId("");
    if (a[3]) setOtherId(a[3]);
    else setOtherId("");
    if (a.length > 4) setExtraContactIds(a.slice(4));
    else setExtraContactIds([]);
  }, [caseRecord]);

  useEffect(() => {
    if (!loading && supabaseReady && !user) router.replace("/login");
  }, [user, loading, supabaseReady, router]);

  if (!hydrated) return <PageSkeleton />;

  async function runExtract() {
    if (!caseId) {
      setErr("Missing case id.");
      return;
    }
    if (!file) {
      setErr("Choose a PDF or DOCX file first.");
      return;
    }
    if (!idToken) {
      setErr("You must be signed in. Please refresh and sign in again.");
      return;
    }
    setExtracting(true);
    setErr(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/extract", {
        method: "POST",
        headers: { Authorization: `Bearer ${idToken}` },
        body: fd,
      });
      let data: { deadlines?: ExtractedDeadline[]; error?: string };
      try {
        data = (await res.json()) as typeof data;
      } catch {
        throw new Error(
          `Server returned ${res.status} ${res.statusText}. Check the terminal for errors.`
        );
      }
      if (!res.ok) {
        throw new Error(
          data.error ?? `Server error (${res.status}). Check terminal logs.`
        );
      }
      const list = data.deadlines ?? [];
      if (!list.length) {
        setErr("The AI did not find any deadlines in this document. Try a different file or clearer scheduling language.");
        return;
      }
      if (!user) return;
      const mapped = extractedToCalendarEvents(caseId, user.id, list);
      mapped.sort((a, b) => a.date.localeCompare(b.date));
      setEvents(mapped);
      setStep(1);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Extract failed — check terminal logs.");
    } finally {
      setExtracting(false);
    }
  }

  function updateEvent(id: string, patch: Partial<CalendarEvent>) {
    setEvents((prev) =>
      prev.map((e) => (e.id === id ? { ...e, ...patch } : e))
    );
  }

  function removeEventRow(id: string) {
    setEvents((prev) => prev.filter((e) => e.id !== id));
  }

  async function finalize() {
    if (!user?.id || !idToken || !caseId || !caseRecord) return;
    if (!datesValidatedConfirmed) {
      setErr("Confirm that the dates and details have been validated before importing.");
      return;
    }
    if (!events.some((e) => e.included)) {
      setErr("Include at least one deadline before saving.");
      return;
    }
    if (!attorneyId || !paralegalId) {
      setErr("Select an attorney and paralegal contact.");
      return;
    }
    const attorney = contacts.find((c) => c.id === attorneyId);
    const paralegal = contacts.find((c) => c.id === paralegalId);
    if (!attorney?.email || !paralegal?.email) {
      setErr("Selected contacts must have the email/ID field filled on their contact.");
      return;
    }
    setBusy(true);
    setErr(null);
    setProgressPct(0);
    setProgressMsg("Updating case…");
    try {
      const supabase = getBrowserSupabase();
      const assignedContactIds = [
        attorneyId,
        paralegalId,
        legalAssistantId,
        otherId,
        ...extraContactIds,
      ].filter(Boolean);
      await updateCase(supabase, caseId, { assignedContactIds });
      setProgressPct(15);

      setProgressMsg("Saving deadlines…");
      const caseEvents = events.map((e) => ({ ...e, caseId, ownerId: user.id }));
      await setEventsForCase(supabase, caseId, user.id, caseEvents);
      setProgressPct(45);

      const displayName = caseDisplayName(caseRecord);
      setProgressMsg("Syncing to Google Calendar…");
      const batches = buildCalendarBatches(caseEvents);
      const allContactIds = assignedContactIds;
      const attendeeEmails = Array.from(
        new Set(
          allContactIds
            .map((id) => contacts.find((c) => c.id === id)?.email)
            .filter((e): e is string => Boolean(e))
        )
      );
      const calRes = await fetch("/api/calendar/sync", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          action: "create",
          caseName: displayName,
          sourceLabel: file?.name ?? "Document with dates",
          events: batches.map((b) => ({
            title: b.title,
            date: b.date,
            description: b.description,
            reminderMinutes: b.reminderMinutes,
            ...(b.startDateTime ? { startDateTime: b.startDateTime } : {}),
            ...(b.endDateTime ? { endDateTime: b.endDateTime } : {}),
            ...(b.location ? { location: b.location } : {}),
          })),
          attendeeEmails,
        }),
      });
      setProgressPct(75);

      const calJson = (await calRes.json()) as {
        googleEventIds?: string[];
        googleEventIdMaps?: Record<string, string>[];
        error?: string;
      };
      if (!calRes.ok) throw new Error(calJson.error ?? "Google Calendar create failed");
      const googleEventIds = calJson.googleEventIds ?? [];
      const googleEventIdMaps = calJson.googleEventIdMaps ?? [];
      let withGoogle: CalendarEvent[] = caseEvents.map((e) => ({ ...e }));
      for (let i = 0; i < batches.length; i++) {
        const ge = googleEventIds[i];
        const map = googleEventIdMaps[i];
        if (!ge) continue;
        for (const eid of batches[i].sourceEventIds) {
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

      setProgressMsg("Finalizing…");
      await Promise.all(withGoogle.map((ev) => saveEvent(supabase, caseId, ev)));
      const included = events.filter((e) => e.included).length;
      await logActivity(supabase, user.id, {
        caseId,
        caseName: displayName,
        action: "event_created",
        description: `Imported ${included} deadline(s) from ${file?.name ?? "document"} (validated import)`,
        userEmail: user.email ?? "",
      });
      setProgressPct(100);
      setProgressMsg("Done! Redirecting…");
      router.push(`/cases/${caseId}`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not import deadlines");
      setProgressMsg(null);
      setProgressPct(0);
    } finally {
      setBusy(false);
    }
  }

  if (!isSupabaseConfigured()) {
    return (
      <PageWrapper>
        <p className="text-text-muted">Configure Supabase to import deadlines.</p>
      </PageWrapper>
    );
  }

  if (!user) return null;

  if (!caseId) {
    return (
      <PageWrapper>
        <p className="text-text-muted">Missing case id.</p>
      </PageWrapper>
    );
  }

  if (!caseResolved) {
    return (
      <PageWrapper className="max-w-[960px]">
        <p className="text-text-muted">Loading case…</p>
      </PageWrapper>
    );
  }

  if (!caseRecord) {
    return (
      <PageWrapper className="max-w-[960px]">
        <p className="text-text-muted">Case not found.</p>
        <Link href="/cases" className="mt-2 inline-block text-sm font-medium text-primary hover:underline">
          All cases
        </Link>
      </PageWrapper>
    );
  }

  if (caseRecord.status === "archived") {
    return (
      <PageWrapper className="max-w-[960px]">
        <p className="text-sm font-medium text-danger">This case is archived. Activate it before importing dates from a document.</p>
        <Link href={`/cases/${caseId}`} className="mt-3 inline-block text-sm font-medium text-primary hover:underline">
          Back to case
        </Link>
      </PageWrapper>
    );
  }

  const attorneys = contacts.filter((c) => c.role === "attorney");
  const paralegals = contacts.filter((c) => c.role === "paralegal");
  const legalAssistants = contacts.filter((c) => c.role === "legal_assistant");
  const others = contacts.filter((c) => c.role === "other");
  const alreadyPicked = new Set([attorneyId, paralegalId, legalAssistantId, otherId, ...extraContactIds].filter(Boolean));
  const availableExtras = contacts.filter((c) => !alreadyPicked.has(c.id));

  return (
    <PageWrapper className="max-w-[960px]">
      {/* Page header */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-text lg:text-3xl">Import Document with Dates</h1>
          <p className="mt-1 text-sm text-text-muted">
            {caseDisplayName(caseRecord)}
          </p>
        </div>
        <Link href={`/cases/${caseId}`} className="text-sm font-medium text-text-muted hover:text-primary">
          Back to case
        </Link>
      </div>

      {/* Step indicator */}
      <div className="mt-6 flex gap-1">
        {stepLabels.map((label, i) => (
          <button
            key={label}
            type="button"
            onClick={() => {
              if (i < step) setStep(i);
            }}
            disabled={i > step}
            className={`flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium transition ${
              step === i
                ? "bg-primary text-white shadow-sm"
                : i < step
                  ? "bg-primary-light text-primary hover:bg-primary/10 cursor-pointer"
                  : "bg-surface-alt text-text-dim cursor-default"
            }`}
          >
            <span className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold ${
              step === i
                ? "bg-white/20 text-white"
                : i < step
                  ? "bg-primary/20 text-primary"
                  : "bg-border text-text-dim"
            }`}>
              {i < step ? "✓" : i + 1}
            </span>
            {label}
          </button>
        ))}
      </div>

      {/* Error banner */}
      {err && (
        <div className="mt-6 rounded-lg border border-danger/20 bg-danger-light px-5 py-3" role="alert">
          <div className="flex items-start justify-between gap-3">
            <p className="text-sm font-medium text-danger">{err}</p>
            <button
              type="button"
              className="text-xs text-danger/60 hover:text-danger"
              onClick={() => setErr(null)}
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {/* ──────── STEP 0: Document ──────── */}
      {step === 0 && (
        <Card className="mt-8">
          <CardHeader>
            <h2 className="text-base font-semibold text-text">Upload Document</h2>
            <p className="mt-1 text-sm text-text-muted">
              Upload a scheduling order or other dated legal document (PDF or DOCX).
            </p>
          </CardHeader>
          <CardBody className="max-w-lg space-y-4">
            <div>
              <Label>Document file</Label>
              <input
                type="file"
                accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                className="mt-1.5 block w-full cursor-pointer rounded-lg border border-border bg-white px-3 py-2.5 text-sm text-text file:mr-3 file:rounded-md file:border-0 file:bg-primary-light file:px-3 file:py-1 file:text-xs file:font-semibold file:text-primary hover:border-primary/40 focus:outline-none"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
            </div>
            {file && !extracting && (
              <div className="flex items-center justify-between rounded-lg bg-primary-light px-4 py-2.5">
                <p className="text-sm font-medium text-primary">
                  {file.name} <span className="font-normal text-text-muted">({(file.size / 1024).toFixed(0)} KB)</span>
                </p>
                <button
                  type="button"
                  className="ml-3 text-sm font-medium text-danger hover:underline"
                  onClick={() => { setFile(null); setEvents([]); setErr(null); }}
                >
                  Remove
                </button>
              </div>
            )}
            {extracting && (
              <div className="flex items-center gap-3 rounded-lg border border-primary/20 bg-primary-light px-5 py-4">
                <Spinner />
                <div>
                  <p className="text-sm font-medium text-text">Extracting deadlines…</p>
                  <p className="text-xs text-text-muted">Parsing document and sending to AI — this may take 15–30 seconds.</p>
                </div>
              </div>
            )}
            {!file && !extracting && (
              <p className="text-xs text-text-dim">Choose a PDF or DOCX file above, then click Upload &amp; Extract.</p>
            )}
            <div className="flex gap-3 pt-2">
              <Link
                href={`/cases/${caseId}`}
                className="inline-flex items-center justify-center rounded-lg border border-border bg-white px-4 py-2 text-sm font-medium text-text shadow-sm transition hover:bg-surface-alt"
              >
                Back to case
              </Link>
              <Button disabled={!file || extracting} onClick={() => void runExtract()}>
                {extracting ? "Extracting…" : "Upload & Extract"}
              </Button>
            </div>
          </CardBody>
        </Card>
      )}

      {/* ──────── STEP 1: Review ──────── */}
      {step === 1 && (
        <div className="mt-8 space-y-4">
          <div>
            <h2 className="text-lg font-semibold text-text">Review Extracted Deadlines</h2>
            <p className="mt-1 text-sm text-text-muted">
              Edit, include/exclude, and set the event type for each deadline. Reminders follow the type (same as Add calendar event).
            </p>
          </div>

          <div className="space-y-4">
            {events.map((ev, idx) => (
              <Card
                key={ev.id}
                className={`transition-opacity ${ev.included ? "" : "opacity-50"}`}
              >
                {/* Card header */}
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-surface-alt text-[10px] font-bold text-text-muted">
                      {idx + 1}
                    </span>
                    <Input
                      type="date"
                      className="w-auto text-sm"
                      value={ev.date}
                      onChange={(e) => updateEvent(ev.id, { date: e.target.value })}
                    />
                    <Select
                      className="min-w-[12rem] max-w-[20rem] flex-1 text-sm"
                      value={ev.eventKind ?? "other_event"}
                      onChange={(e) => {
                        const k = e.target.value as EventKind;
                        updateEvent(ev.id, {
                          eventKind: k,
                          category: categoryForManualEventKind(k),
                          remindersMinutes: [...getRemindersForEventKind(k)],
                        });
                      }}
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
                    <Badge variant={catBadge[ev.category]}>{ev.category}</Badge>
                    <label className="flex items-center gap-1.5 text-xs font-medium text-text-secondary">
                      <input
                        type="checkbox"
                        className="h-4 w-4 rounded border-border text-primary focus:ring-primary/30"
                        checked={ev.included}
                        onChange={(e) => updateEvent(ev.id, { included: e.target.checked })}
                      />
                      Include
                    </label>
                    {ev.noiseFlag && (
                      <Badge variant="warning">{ev.noiseReason ?? "Noise"}</Badge>
                    )}
                  </div>
                  <button
                    type="button"
                    title="Remove this deadline"
                    className="text-sm font-bold text-danger/50 transition hover:text-danger"
                    onClick={() => removeEventRow(ev.id)}
                  >
                    ✕
                  </button>
                </div>

                {/* Card body */}
                <CardBody>
                  <div className="grid gap-5 sm:grid-cols-2">
                    <div className="space-y-3">
                      <div>
                        <Label>Title</Label>
                        <Input
                          className="mt-1.5"
                          value={ev.title}
                          onChange={(e) => updateEvent(ev.id, { title: e.target.value })}
                        />
                      </div>
                      <div>
                        <Label>Description</Label>
                        <Textarea
                          rows={4}
                          className="mt-1.5"
                          value={ev.description}
                          onChange={(e) => updateEvent(ev.id, { description: e.target.value })}
                        />
                      </div>
                    </div>

                    <div className="space-y-4">
                      <FixedRemindersReadout minutes={getRemindersForEventKind(ev.eventKind ?? "other_event")} />
                    </div>
                  </div>
                </CardBody>
              </Card>
            ))}
          </div>

          <div className="flex gap-3 pt-2">
            <Button variant="secondary" onClick={() => setStep(0)}>Back</Button>
            <Button onClick={() => setStep(2)}>Continue</Button>
          </div>
        </div>
      )}

      {/* ──────── STEP 2: Assign ──────── */}
      {step === 2 && (
        <Card className="mt-8">
          <CardHeader>
            <h2 className="text-base font-semibold text-text">Assign Participants</h2>
            <p className="mt-1 text-sm text-text-muted">
              Choose who receives the Google Calendar invitations.
            </p>
          </CardHeader>
          <CardBody className="max-w-lg space-y-4">
            <div>
              <Label required>Attorney</Label>
              <Select className="mt-1.5" required value={attorneyId} onChange={(e) => setAttorneyId(e.target.value)}>
                <option value="">Select…</option>
                {attorneys.map((c) => (
                  <option key={c.id} value={c.id}>{c.name} — {c.email}</option>
                ))}
              </Select>
            </div>
            <div>
              <Label required>Paralegal</Label>
              <Select className="mt-1.5" required value={paralegalId} onChange={(e) => setParalegalId(e.target.value)}>
                <option value="">Select…</option>
                {paralegals.map((c) => (
                  <option key={c.id} value={c.id}>{c.name} — {c.email}</option>
                ))}
              </Select>
            </div>
            <div>
              <Label>Legal Assistant</Label>
              <Select className="mt-1.5" value={legalAssistantId} onChange={(e) => setLegalAssistantId(e.target.value)}>
                <option value="">None</option>
                {legalAssistants.map((c) => (
                  <option key={c.id} value={c.id}>{c.name} — {c.email}</option>
                ))}
              </Select>
            </div>
            <div>
              <Label>Other</Label>
              <Select className="mt-1.5" value={otherId} onChange={(e) => setOtherId(e.target.value)}>
                <option value="">None</option>
                {others.map((c) => (
                  <option key={c.id} value={c.id}>{c.name} — {c.email}</option>
                ))}
              </Select>
            </div>

            {/* Dynamic extra participants */}
            {extraContactIds.length > 0 && (
              <div className="space-y-2">
                <Label>Additional Participants</Label>
                {extraContactIds.map((eid, i) => {
                  const contact = contacts.find((c) => c.id === eid);
                  return (
                    <div key={eid} className="flex items-center gap-2">
                      <Select
                        className="mt-0 flex-1"
                        value={eid}
                        onChange={(e) => {
                          const updated = [...extraContactIds];
                          updated[i] = e.target.value;
                          setExtraContactIds(updated);
                        }}
                      >
                        <option value="">Select…</option>
                        {contacts
                          .filter((c) => c.id === eid || !alreadyPicked.has(c.id))
                          .map((c) => (
                            <option key={c.id} value={c.id}>{c.name} — {c.email}</option>
                          ))}
                      </Select>
                      {contact && (
                        <Badge variant="default">{contact.role}</Badge>
                      )}
                      <Button
                        variant="danger"
                        size="sm"
                        onClick={() =>
                          setExtraContactIds(extraContactIds.filter((_, j) => j !== i))
                        }
                      >
                        ✕
                      </Button>
                    </div>
                  );
                })}
              </div>
            )}

            {availableExtras.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setExtraContactIds([...extraContactIds, ""])}
              >
                + Add another participant
              </Button>
            )}

            <p className="text-xs text-text-dim">
              Tip: set the correct role on each contact in{" "}
              <Link href="/contacts" className="font-medium text-primary hover:underline">Contacts</Link>.
            </p>
            <div className="flex gap-3 pt-2">
              <Button variant="secondary" onClick={() => setStep(1)}>Back</Button>
              <Button onClick={() => setStep(3)}>Review &amp; Import</Button>
            </div>
          </CardBody>
        </Card>
      )}

      {/* ──────── STEP 3: Confirm ──────── */}
      {step === 3 && (
        <Card className="mt-8">
          <CardHeader>
            <h2 className="text-base font-semibold text-text">Confirm &amp; Import</h2>
          </CardHeader>
          <CardBody className="max-w-lg">
            <dl className="space-y-3 text-sm">
              <div className="flex gap-3">
                <dt className="w-28 shrink-0 font-medium text-text-muted">Case</dt>
                <dd className="text-text">{name}</dd>
              </div>
              <div className="flex gap-3">
                <dt className="w-28 shrink-0 font-medium text-text-muted">Client</dt>
                <dd className="text-text">{clientName}</dd>
              </div>
              <div className="flex gap-3">
                <dt className="w-28 shrink-0 font-medium text-text-muted">Events</dt>
                <dd className="text-text">{events.filter((e) => e.included).length} included</dd>
              </div>
              <div className="flex gap-3">
                <dt className="w-28 shrink-0 font-medium text-text-muted">Document</dt>
                <dd className="text-text">{file?.name ?? "None"}</dd>
              </div>
            </dl>
            {busy && progressMsg && (
              <div className="mt-8 space-y-3">
                <div className="flex items-center gap-3">
                  <Spinner className="h-4 w-4" />
                  <p className="text-sm font-medium text-text">{progressMsg}</p>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-surface-alt">
                  <div
                    className="h-full rounded-full bg-primary transition-all duration-500 ease-out"
                    style={{ width: `${progressPct}%` }}
                  />
                </div>
                <p className="text-xs text-text-dim">
                  Please don&apos;t close this page while creation is in progress.
                </p>
              </div>
            )}

            {!busy && (
              <>
                <div className="mt-8 rounded-lg border border-border bg-surface-alt/60 px-4 py-3">
                  <label className="flex cursor-pointer items-start gap-3 text-sm text-text">
                    <input
                      type="checkbox"
                      className="mt-0.5 h-4 w-4 shrink-0 rounded border-border text-primary focus:ring-primary/30"
                      checked={datesValidatedConfirmed}
                      onChange={(e) => {
                        setDatesValidatedConfirmed(e.target.checked);
                        if (e.target.checked) setErr(null);
                      }}
                    />
                    <span>
                      <span className="font-semibold text-text">Validation required.</span>{" "}
                      Someone with authority over this case has reviewed the extracted dates, titles, and details and
                      confirms they match the source document before calendar import.
                    </span>
                  </label>
                </div>
                <div className="mt-6 flex gap-3">
                  <Button variant="secondary" onClick={() => setStep(2)}>Back</Button>
                  <Button disabled={!datesValidatedConfirmed} onClick={() => void finalize()}>
                    Import &amp; Sync to Calendar
                  </Button>
                </div>
              </>
            )}
          </CardBody>
        </Card>
      )}
    </PageWrapper>
  );
}
