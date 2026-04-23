"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { getBrowserSupabase } from "@/lib/supabase/singleton";
import { createSolMilestoneEvents } from "@/lib/event-factory";
import { buildSolMilestoneSpecs } from "@/lib/sol-milestones";
import { createCase, logActivity, saveEvent, subscribeContacts } from "@/lib/supabase/repo";
import { adjustSolWeekendToFriday, statuteLimitDateIsoForCalendar } from "@/lib/sol";
import { DEFAULT_REMINDERS } from "@/lib/reminder-presets";
import type { Contact } from "@/lib/types";
import { PageSkeleton } from "@/components/PageSkeleton";
import { ReminderMinutesEditor } from "@/components/ReminderMinutesEditor";
import { useHydrated } from "@/hooks/useHydrated";
import { Button, Card, CardBody, Input, Label, PageWrapper, Select, Textarea } from "@/components/ui";

export default function NewCasePage() {
  const router = useRouter();
  const hydrated = useHydrated();
  const { user, loading, idToken, supabaseReady } = useAuth();
  const [contacts, setContacts] = useState<Contact[]>([]);

  const [caseNumber, setCaseNumber] = useState("");
  const [clientName, setClientName] = useState("");
  const [dateOfIncident, setDateOfIncident] = useState("");
  const [attorneyId, setAttorneyId] = useState("");
  const [paralegalId, setParalegalId] = useState("");
  /** Extra people on the case (beyond required attorney + paralegal) */
  const [extraAssigneeIds, setExtraAssigneeIds] = useState<string[]>([]);
  const [notes, setNotes] = useState("");
  const [caseType, setCaseType] = useState("");
  const [solDate, setSolDate] = useState("");
  const [solRemindersMinutes, setSolRemindersMinutes] = useState<number[]>(() => [
    ...DEFAULT_REMINDERS.other,
  ]);

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!supabaseReady || loading || !user) return;
    const supabase = getBrowserSupabase();
    return subscribeContacts(supabase, user.id, setContacts);
  }, [user, loading, supabaseReady]);

  useEffect(() => {
    if (!loading && supabaseReady && !user) router.replace("/login");
  }, [user, loading, supabaseReady, router]);

  useEffect(() => {
    if (!dateOfIncident) {
      setSolDate("");
      return;
    }
    setSolDate(statuteLimitDateIsoForCalendar(dateOfIncident, 2));
  }, [dateOfIncident]);

  const solMilestonePreview = useMemo(() => {
    const doi = dateOfIncident.trim();
    const sol = (solDate || (doi ? statuteLimitDateIsoForCalendar(doi, 2) : "")).slice(0, 10);
    if (!doi || !sol) return [];
    try {
      const specs = buildSolMilestoneSpecs(sol, doi, solRemindersMinutes);
      const cn = caseNumber.trim();
      const cl = clientName.trim();
      const label = cn && cl ? `${cl} (${cn})` : null;
      return specs.map((s) => ({
        date: s.date,
        line: label ? `${s.googleSummaryStem} - ${label}` : s.googleSummaryStem,
      }));
    } catch {
      return [];
    }
  }, [dateOfIncident, solDate, solRemindersMinutes, caseNumber, clientName]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!user?.id || !idToken) return;
    const cn = caseNumber.trim();
    const cl = clientName.trim();
    const doi = dateOfIncident.trim();
    if (!cn || !cl || !doi) {
      setErr("Case number, client name, and date of incident are required.");
      return;
    }
    if (!attorneyId || !paralegalId) {
      setErr("Attorney and paralegal are required.");
      return;
    }
    const attorney = contacts.find((c) => c.id === attorneyId);
    const paralegal = contacts.find((c) => c.id === paralegalId);
    if (!attorney?.email || !paralegal?.email) {
      setErr("Selected attorney and paralegal must have the email/ID field filled on their contact (use a real email for Google).");
      return;
    }
    const sol = adjustSolWeekendToFriday(
      (solDate || statuteLimitDateIsoForCalendar(doi, 2)).slice(0, 10)
    );

    setBusy(true);
    setErr(null);
    try {
      const supabase = getBrowserSupabase();
      const displayName = `${cl} (${cn})`;
      const extraIds = extraAssigneeIds.filter(
        (id) => id && id !== attorneyId && id !== paralegalId
      );
      const assignedContactIds = [...new Set([attorneyId, paralegalId, ...extraIds])];
      const caseId = await createCase(supabase, user.id, {
        name: displayName,
        clientName: cl,
        caseNumber: cn,
        causeNumber: cn,
        dateOfIncident: doi,
        notes: notes.trim() || null,
        caseType: caseType.trim() || null,
        assignedContactIds,
      });

      const solEvents = createSolMilestoneEvents(
        caseId,
        user.id,
        sol,
        doi,
        [...solRemindersMinutes],
        displayName
      );
      for (const ev of solEvents) {
        await saveEvent(supabase, caseId, ev);
      }

      const calRes = await fetch("/api/calendar/sync", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          action: "create_sol_milestones",
          caseName: displayName,
          sourceLabel: "SOL",
          solDate: sol,
          incidentDate: doi,
          remindersFinalMinutes: solRemindersMinutes,
          milestones: solEvents.map((e) => ({
            id: e.id,
            date: e.date,
            eventKind: e.eventKind ?? "sol",
          })),
        }),
      });
      const calJson = (await calRes.json()) as {
        googleEventIds?: string[];
        hostCalendarId?: string;
        error?: string;
      };
      if (!calRes.ok) throw new Error(calJson.error ?? "Google Calendar sync failed");

      const googleEventIds = calJson.googleEventIds ?? [];
      const hostCalendarId = calJson.hostCalendarId;
      if (googleEventIds.length > 0 && hostCalendarId) {
        for (let i = 0; i < solEvents.length; i++) {
          const ge = googleEventIds[i];
          if (!ge) continue;
          const row = solEvents[i]!;
          await saveEvent(supabase, caseId, {
            ...row,
            googleEventId: ge,
            googleHostCalendarId: hostCalendarId,
            googleCalendarEventIdsByEmail: undefined,
          });
        }
      }

      await logActivity(supabase, user.id, {
        caseId,
        caseName: displayName,
        action: "case_created",
        description: `Created case with SOL milestones ending ${sol} (${solEvents.length} checkpoints)`,
        userEmail: user.email ?? "",
      });

      router.push(`/cases/${caseId}`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not create case");
    } finally {
      setBusy(false);
    }
  }

  if (!hydrated) return <PageSkeleton />;
  if (!isSupabaseConfigured()) {
    return (
      <PageWrapper>
        <p className="text-text-muted">Configure Supabase to create cases.</p>
      </PageWrapper>
    );
  }
  if (!user) return null;

  const attorneys = contacts.filter((c) => c.role === "attorney");
  const paralegals = contacts.filter((c) => c.role === "paralegal");

  return (
    <PageWrapper className="max-w-[560px]">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold tracking-tight text-text">New case</h1>
        <Link href="/cases" className="text-sm font-medium text-text-muted hover:text-primary">
          Cancel
        </Link>
      </div>
      <p className="mt-2 text-sm text-text-muted">
        Create the case first, then import dates from a document, add depositions, and other events from the case page.
      </p>

      <Card className="mt-8">
        <CardBody>
          <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
            <div>
              <Label required>Case number</Label>
              <Input className="mt-1.5" value={caseNumber} onChange={(e) => setCaseNumber(e.target.value)} required />
            </div>
            <div>
              <Label required>Client name</Label>
              <Input className="mt-1.5" value={clientName} onChange={(e) => setClientName(e.target.value)} required />
            </div>
            <div>
              <Label required>Date of incident</Label>
              <Input
                type="date"
                className="mt-1.5"
                value={dateOfIncident}
                onChange={(e) => setDateOfIncident(e.target.value)}
                required
              />
            </div>
            <div>
              <Label>Statute of limitations (2 years)</Label>
              <Input
                type="date"
                className="mt-1.5"
                value={solDate}
                onChange={(e) => setSolDate(e.target.value)}
              />
              <p className="mt-1 text-xs text-text-dim">Defaults to incident + 2 years. Edit if needed.</p>
            </div>
            <div className="rounded-lg border border-border bg-surface-alt/50 px-4 py-3 space-y-3">
              <div>
                <p className="text-sm font-medium text-text">SOL milestones on the firm calendar</p>
                <p className="mt-1 text-xs text-text-muted leading-relaxed">
                  DocketFlow creates <strong className="text-text">six all-day Google Calendar events</strong> on the{" "}
                  <strong className="font-semibold text-danger">SOL calendar</strong> (via{" "}
                  <strong className="text-text">legalassistant@ramosjames.com</strong> on the server). One row per
                  checkpoint: <strong className="text-text">6 months</strong>,{" "}
                  <strong className="text-text">90 days</strong>, <strong className="text-text">6 weeks</strong>,{" "}
                  <strong className="text-text">4 weeks</strong>, <strong className="text-text">1 week</strong>, and
                  the <strong className="text-text">SOL due date</strong>. If two offsets fall on the same day, only
                  one calendar row is created for that day. These are <strong className="text-text">not</strong>{" "}
                  multi-attendee invites; team invites still come from events you add on the case page.
                </p>
              </div>
              {solMilestonePreview.length > 0 ? (
                <ul className="list-inside list-disc space-y-1 text-xs text-text-muted">
                  {solMilestonePreview.map((m) => (
                    <li key={`${m.date}-${m.line}`}>
                      <span className="text-text">{m.date}</span> — {m.line}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-text-dim">Set date of incident (and SOL date) to preview milestone dates.</p>
              )}
              <div>
                <p className="text-xs font-medium text-text">Google reminders (due date only)</p>
                <p className="mt-0.5 text-xs text-text-muted">
                  Popup reminders below apply only to the <strong className="text-text">final SOL due date</strong>{" "}
                  row. Lead-up milestones use a standard 7-day and 1-day reminder on Google.
                </p>
                <div className="mt-2">
                  <ReminderMinutesEditor value={solRemindersMinutes} onChange={setSolRemindersMinutes} />
                </div>
              </div>
            </div>
            <div>
              <Label required>Attorney</Label>
              <Select className="mt-1.5" value={attorneyId} onChange={(e) => setAttorneyId(e.target.value)} required>
                <option value="">Select…</option>
                {attorneys.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </Select>
            </div>
            <div>
              <Label required>Paralegal</Label>
              <Select className="mt-1.5" value={paralegalId} onChange={(e) => setParalegalId(e.target.value)} required>
                <option value="">Select…</option>
                {paralegals.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </Select>
            </div>
            <div>
              <div className="flex items-center justify-between gap-2">
                <Label>Additional people on this case</Label>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="shrink-0"
                  onClick={() => setExtraAssigneeIds((prev) => [...prev, ""])}
                >
                  + Add person
                </Button>
              </div>
              <p className="mt-1 text-xs text-text-muted">
                Optional — associates, assistants, or others on the case. They receive invites for team calendar events
                you add later; SOL milestones use the firm SOL calendar above, not this list.
              </p>
              <div className="mt-2 space-y-2">
                {extraAssigneeIds.map((rowId, idx) => (
                  <div key={idx} className="flex items-center gap-2">
                    <Select
                      className="min-w-0 flex-1"
                      value={rowId}
                      onChange={(e) => {
                        const v = e.target.value;
                        setExtraAssigneeIds((prev) => {
                          const next = [...prev];
                          next[idx] = v;
                          return next;
                        });
                      }}
                    >
                      <option value="">Select contact…</option>
                      {contacts
                        .filter((ct) => ct.id !== attorneyId && ct.id !== paralegalId)
                        .map((ct) => (
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
                        setExtraAssigneeIds((prev) => prev.filter((_, j) => j !== idx))
                      }
                    >
                      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <Label>Case type</Label>
              <Input className="mt-1.5" value={caseType} onChange={(e) => setCaseType(e.target.value)} placeholder="Optional" />
            </div>
            <div>
              <Label>Notes</Label>
              <Textarea className="mt-1.5" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" />
            </div>

            {err && (
              <div className="rounded-lg border border-danger/20 bg-danger-light px-3 py-2 text-sm text-danger" role="alert">
                {err}
              </div>
            )}

            <Button type="submit" className="w-full" disabled={busy} variant="pink" size="lg">
              {busy ? "Creating…" : "Create case"}
            </Button>
          </form>
        </CardBody>
      </Card>
    </PageWrapper>
  );
}
