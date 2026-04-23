"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { v4 as uuidv4 } from "uuid";
import { useAuth } from "@/context/AuthContext";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { getBrowserSupabase } from "@/lib/supabase/singleton";
import { getRemindersForEventKind } from "@/lib/case-event-kinds";
import { baseEvent } from "@/lib/event-factory";
import { CASE_IMPORT_CSV_TEMPLATE, parseCasesImportCsv } from "@/lib/import-cases-csv";
import type { ParsedIcsEvent } from "@/lib/ics-parse";
import {
  ALL_EVENT_KIND_SELECT_GROUPS,
  categoryForManualEventKind,
} from "@/lib/one-off-events";
import {
  createCase,
  fetchCasesForUser,
  fetchContactsForUser,
  logActivity,
  saveEvent,
} from "@/lib/supabase/repo";
import type { Case, Contact, EventKind } from "@/lib/types";
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

type PendingCaseDraft = {
  draftId: string;
  clientName: string;
  caseNumber: string;
  dateOfIncident: string;
  attorneyId: string;
  paralegalId: string;
};

type ReviewRow = ParsedIcsEvent & {
  rowId: string;
  included: boolean;
  eventKind: EventKind;
  /** `existing:<caseId>` or `draft:<draftId>` */
  assignTo: string;
};

function newPendingCase(): PendingCaseDraft {
  return {
    draftId: uuidv4(),
    clientName: "",
    caseNumber: "",
    dateOfIncident: "",
    attorneyId: "",
    paralegalId: "",
  };
}

export default function ImportCalendarPage() {
  const router = useRouter();
  const hydrated = useHydrated();
  const { user, loading, idToken, supabaseReady } = useAuth();
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [existingCases, setExistingCases] = useState<Case[]>([]);
  const [pendingCases, setPendingCases] = useState<PendingCaseDraft[]>([]);
  const [rows, setRows] = useState<ReviewRow[]>([]);
  const [parseBusy, setParseBusy] = useState(false);
  const [importBusy, setImportBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && supabaseReady && !user) router.replace("/login");
  }, [user, loading, supabaseReady, router]);

  useEffect(() => {
    if (!supabaseReady || loading || !user) return;
    const supabase = getBrowserSupabase();
    let cancelled = false;
    (async () => {
      try {
        const [clist, cases] = await Promise.all([
          fetchContactsForUser(supabase, user.id),
          fetchCasesForUser(supabase, user.id),
        ]);
        if (cancelled) return;
        setContacts(clist);
        setExistingCases(cases.filter((c) => c.status === "active"));
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : "Failed to load data");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user, loading, supabaseReady]);

  const attorneys = useMemo(() => contacts.filter((c) => c.role === "attorney"), [contacts]);
  const paralegals = useMemo(() => contacts.filter((c) => c.role === "paralegal"), [contacts]);

  async function onCasesCsvUpload(file: File | null) {
    if (!file) return;
    if (!contacts.length) {
      setErr("Load contacts first, then upload a CSV — attorney and paralegal cells must match a name or email on your Contacts list.");
      return;
    }
    setErr(null);
    setMsg(null);
    try {
      const text = await file.text();
      const { rows: parsed, errors } = parseCasesImportCsv(text, contacts);
      if (!parsed.length) {
        setErr(errors.length ? errors.join("\n") : "No valid rows in CSV.");
        return;
      }
      setPendingCases((prev) => [
        ...prev,
        ...parsed.map((r) => ({
          draftId: uuidv4(),
          clientName: r.clientName,
          caseNumber: r.caseNumber,
          dateOfIncident: r.dateOfIncident,
          attorneyId: r.attorneyId,
          paralegalId: r.paralegalId,
        })),
      ]);
      setErr(null);
      setMsg(
        errors.length
          ? `Added ${parsed.length} case(s) from CSV. Rows not imported: ${errors.join(" ")}`
          : `Added ${parsed.length} case(s) from CSV. Assign events to “New: …” in step 3.`
      );
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not read CSV");
    }
  }

  async function onParseFile(file: File | null) {
    if (!file || !idToken) {
      setErr("Choose an .ics file and sign in.");
      return;
    }
    setParseBusy(true);
    setErr(null);
    setMsg(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/calendar/parse-ics", {
        method: "POST",
        headers: { Authorization: `Bearer ${idToken}` },
        body: fd,
      });
      const raw = await res.text();
      let data: { events?: ParsedIcsEvent[]; error?: string };
      try {
        data = JSON.parse(raw) as { events?: ParsedIcsEvent[]; error?: string };
      } catch {
        const trimmed = raw.trimStart();
        if (trimmed.startsWith("<!DOCTYPE") || trimmed.startsWith("<html")) {
          throw new Error(
            "Server returned an HTML page instead of JSON — usually the API route failed to run (restart `next dev` after config changes) or the URL hit a 404. Ensure `node-ical` is listed under serverExternalPackages in next.config."
          );
        }
        throw new Error(`Invalid response (${res.status}): ${raw.slice(0, 160).replace(/\s+/g, " ")}`);
      }
      if (!res.ok) throw new Error(data.error ?? "Parse failed");
      const list = data.events ?? [];
      if (!list.length) {
        setMsg("No events from today onward were found in this file.");
        setRows([]);
        return;
      }
      setRows(
        list.map((e) => ({
          ...e,
          rowId: uuidv4(),
          included: true,
          eventKind: "other_event",
          assignTo: "",
        }))
      );
      setMsg(
        `Loaded ${list.length} event(s) from today forward (cutoff uses America/Chicago, same as the rest of DocketFlow).`
      );
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Parse failed");
    } finally {
      setParseBusy(false);
    }
  }

  function updateRow(rowId: string, patch: Partial<ReviewRow>) {
    setRows((prev) => prev.map((r) => (r.rowId !== rowId ? r : { ...r, ...patch })));
  }

  async function runImport() {
    if (!user?.id || !idToken) return;
    const included = rows.filter((r) => r.included);
    if (!included.length) {
      setErr("Include at least one event.");
      return;
    }
    for (const r of included) {
      if (!r.assignTo) {
        setErr(`Assign a case for every included row (“${r.title}”).`);
        return;
      }
    }

    const draftIdsUsed = new Set<string>();
    for (const r of included) {
      if (r.assignTo.startsWith("draft:")) draftIdsUsed.add(r.assignTo.slice("draft:".length));
    }
    for (const did of draftIdsUsed) {
      const d = pendingCases.find((p) => p.draftId === did);
      if (!d) {
        setErr("Each new case in the assignment list must still exist in “Cases to create.”");
        return;
      }
      const cl = d.clientName.trim();
      const cn = d.caseNumber.trim();
      if (!cl || !cn) {
        setErr("New cases need client name and case number.");
        return;
      }
      if (!d.attorneyId || !d.paralegalId) {
        setErr("New cases need attorney and paralegal.");
        return;
      }
      const att = contacts.find((c) => c.id === d.attorneyId);
      const par = contacts.find((c) => c.id === d.paralegalId);
      if (!att?.email?.trim() || !par?.email?.trim()) {
        setErr("Attorney and paralegal must have email addresses.");
        return;
      }
    }

    setImportBusy(true);
    setErr(null);
    setMsg(null);
    try {
      const supabase = getBrowserSupabase();
      const draftToCaseId = new Map<string, string>();

      for (const did of draftIdsUsed) {
        const d = pendingCases.find((p) => p.draftId === did)!;
        const displayName = `${d.clientName.trim()} (${d.caseNumber.trim()})`;
        const caseId = await createCase(supabase, user.id, {
          name: displayName,
          clientName: d.clientName.trim(),
          caseNumber: d.caseNumber.trim(),
          causeNumber: d.caseNumber.trim(),
          dateOfIncident: d.dateOfIncident.trim() || null,
          assignedContactIds: [d.attorneyId, d.paralegalId].filter(Boolean),
        });
        draftToCaseId.set(did, caseId);
        await logActivity(supabase, user.id, {
          caseId,
          caseName: displayName,
          action: "case_created",
          description: `Case created from ICS import`,
          userEmail: user.email ?? "",
        });
      }

      function resolveCaseId(assignTo: string): string {
        if (assignTo.startsWith("existing:")) return assignTo.slice("existing:".length);
        if (assignTo.startsWith("draft:")) {
          const id = draftToCaseId.get(assignTo.slice("draft:".length));
          if (!id) throw new Error("Missing draft case mapping");
          return id;
        }
        throw new Error("Invalid assignment");
      }

      let saved = 0;
      for (const r of included) {
        const caseId = resolveCaseId(r.assignTo);
        const cat = categoryForManualEventKind(r.eventKind);
        const desc =
          (r.description.trim() ? `${r.description.trim()}\n\n` : "") +
          (r.location ? `Location (from ICS): ${r.location}\n\n` : "") +
          `[ICS UID: ${r.icsUid}]`;

        const zoom =
          r.location?.trim().startsWith("http") ? r.location.trim() : null;

        const calEv = baseEvent(caseId, user.id, {
          title: r.title.trim() || "Calendar event",
          date: r.date,
          description: desc,
          category: cat,
          eventKind: r.eventKind,
          calendarOrigin: "google_ics_mirror",
          startDateTime: r.startDateTime,
          endDateTime: r.endDateTime,
          zoomLink: zoom,
          remindersMinutes: [...getRemindersForEventKind(r.eventKind)],
          included: true,
          completed: false,
        });
        await saveEvent(supabase, caseId, calEv);
        saved++;
      }

      await logActivity(supabase, user.id, {
        action: "event_created",
        description: `Imported ${saved} ICS event(s) from Google Calendar export (DocketFlow mirror only)`,
        userEmail: user.email ?? "",
      });

      setMsg(`Imported ${saved} event(s). They appear as “Originally from Google” and are not synced to Google from here.`);
      setRows([]);
      setPendingCases([]);
      const cases = await fetchCasesForUser(supabase, user.id);
      setExistingCases(cases.filter((c) => c.status === "active"));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Import failed");
    } finally {
      setImportBusy(false);
    }
  }

  if (!hydrated) return <PageSkeleton />;

  if (!isSupabaseConfigured()) {
    return (
      <PageWrapper>
        <p className="text-text-muted">Configure Supabase to use this page.</p>
      </PageWrapper>
    );
  }

  if (!user) return null;

  const includedCount = rows.filter((r) => r.included).length;

  return (
    <PageWrapper>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-text">Import Google Calendar (.ics)</h1>
        <p className="mt-2 max-w-3xl text-sm text-text-muted">
          Export a calendar from Google Calendar as iCalendar (.ics), then upload it here. Only events from{" "}
          <span className="font-medium text-text-secondary">today through the next few years</span> are loaded.
          Events are stored in DocketFlow only (labeled “Originally from Google”) — they are{" "}
          <span className="font-medium text-text-secondary">not</span> created or linked in Google Calendar from this
          app. Assign each row to an existing case or to a new case you define below.
        </p>
      </div>

      {err && (
        <div className="mb-6 rounded-lg border border-danger/20 bg-danger-light px-4 py-3 text-sm text-danger" role="alert">
          {err}
        </div>
      )}
      {msg && (
        <div className="mb-6 rounded-lg border border-primary/20 bg-primary-light px-4 py-3 text-sm text-primary" role="status">
          {msg}
        </div>
      )}

      <Card className="mb-6">
        <CardHeader>
          <h2 className="text-base font-semibold text-text">1. Cases to create (optional)</h2>
          <p className="mt-1 text-sm text-text-muted">
            Add one row per <span className="font-medium">new</span> matter, or upload a CSV. In step 3, assign each
            event to a “New: …” entry or an existing case.
          </p>
        </CardHeader>
        <CardBody className="space-y-4">
          <div className="rounded-lg border border-border bg-white px-4 py-3">
            <Label>Upload cases CSV</Label>
            <p className="mt-1 text-xs text-text-dim">
              Required: <span className="font-mono text-text-secondary">case_number</span>,{" "}
              <span className="font-mono text-text-secondary">client_name</span>,{" "}
              <span className="font-mono text-text-secondary">attorney_name</span> /{" "}
              <span className="font-mono text-text-secondary">paralegal_name</span> (or{" "}
              <span className="font-mono text-text-secondary">attorney_email</span> /{" "}
              <span className="font-mono text-text-secondary">paralegal_email</span>, or{" "}
              <span className="font-mono text-text-secondary">attorney</span> /{" "}
              <span className="font-mono text-text-secondary">paralegal</span>) — values must match Contacts. Optional:{" "}
              <span className="font-mono text-text-secondary">date_of_incident</span> (YYYY-MM-DD or M/D/YYYY). Headers
              can vary (e.g. “Case #”). Rows append below.
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <input
                type="file"
                accept=".csv,text/csv"
                className="block max-w-full cursor-pointer text-sm file:mr-3 file:rounded-md file:border-0 file:bg-primary-light file:px-3 file:py-1 file:text-xs file:font-semibold file:text-primary"
                onChange={(e) => void onCasesCsvUpload(e.target.files?.[0] ?? null)}
              />
              <a
                href={`data:text/csv;charset=utf-8,${encodeURIComponent(CASE_IMPORT_CSV_TEMPLATE)}`}
                download="docketflow-case-import-template.csv"
                className="text-xs font-medium text-primary hover:underline"
              >
                Download template
              </a>
            </div>
          </div>
          {pendingCases.length === 0 && (
            <p className="text-sm text-text-dim">
              No pending new cases yet. Upload a CSV, or use “Add new case” for one-off matters.
            </p>
          )}
          {pendingCases.map((d, idx) => (
            <div
              key={d.draftId}
              className="grid gap-3 rounded-lg border border-border bg-surface-alt/40 p-4 sm:grid-cols-2 lg:grid-cols-3"
            >
              <div className="sm:col-span-2 lg:col-span-3 flex items-center justify-between gap-2">
                <span className="text-xs font-semibold uppercase tracking-wide text-text-dim">New case {idx + 1}</span>
                <button
                  type="button"
                  className="text-xs font-medium text-danger hover:underline"
                  onClick={() => setPendingCases((prev) => prev.filter((p) => p.draftId !== d.draftId))}
                >
                  Remove
                </button>
              </div>
              <div>
                <Label>Client name</Label>
                <Input
                  className="mt-1.5"
                  value={d.clientName}
                  onChange={(e) =>
                    setPendingCases((prev) =>
                      prev.map((p) => (p.draftId === d.draftId ? { ...p, clientName: e.target.value } : p))
                    )
                  }
                />
              </div>
              <div>
                <Label>Case number</Label>
                <Input
                  className="mt-1.5"
                  value={d.caseNumber}
                  onChange={(e) =>
                    setPendingCases((prev) =>
                      prev.map((p) => (p.draftId === d.draftId ? { ...p, caseNumber: e.target.value } : p))
                    )
                  }
                />
              </div>
              <div>
                <Label>Date of incident (optional)</Label>
                <Input
                  type="date"
                  className="mt-1.5"
                  value={d.dateOfIncident}
                  onChange={(e) =>
                    setPendingCases((prev) =>
                      prev.map((p) => (p.draftId === d.draftId ? { ...p, dateOfIncident: e.target.value } : p))
                    )
                  }
                />
              </div>
              <div>
                <Label>Attorney</Label>
                <Select
                  className="mt-1.5"
                  value={d.attorneyId}
                  onChange={(e) =>
                    setPendingCases((prev) =>
                      prev.map((p) => (p.draftId === d.draftId ? { ...p, attorneyId: e.target.value } : p))
                    )
                  }
                >
                  <option value="">Select…</option>
                  {attorneys.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <Label>Paralegal</Label>
                <Select
                  className="mt-1.5"
                  value={d.paralegalId}
                  onChange={(e) =>
                    setPendingCases((prev) =>
                      prev.map((p) => (p.draftId === d.draftId ? { ...p, paralegalId: e.target.value } : p))
                    )
                  }
                >
                  <option value="">Select…</option>
                  {paralegals.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              </div>
            </div>
          ))}
          <Button type="button" variant="secondary" onClick={() => setPendingCases((p) => [...p, newPendingCase()])}>
            + Add new case
          </Button>
        </CardBody>
      </Card>

      <Card className="mb-6">
        <CardHeader>
          <h2 className="text-base font-semibold text-text">2. Upload .ics file</h2>
        </CardHeader>
        <CardBody className="flex flex-wrap items-end gap-4">
          <div className="min-w-[200px] flex-1">
            <Label>iCalendar file</Label>
            <input
              type="file"
              accept=".ics,text/calendar"
              className="mt-1.5 block w-full cursor-pointer rounded-lg border border-border bg-white px-3 py-2 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-primary-light file:px-3 file:py-1 file:text-xs file:font-semibold file:text-primary"
              disabled={parseBusy}
              onChange={(e) => void onParseFile(e.target.files?.[0] ?? null)}
            />
          </div>
          {parseBusy && (
            <div className="flex items-center gap-2 text-sm text-text-muted">
              <Spinner className="h-4 w-4" />
              Parsing…
            </div>
          )}
        </CardBody>
      </Card>

      {rows.length > 0 && (
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-base font-semibold text-text">3. Review & assign</h2>
              <Badge variant="default">{includedCount} included</Badge>
            </div>
          </CardHeader>
          <CardBody className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[920px] border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b border-border bg-surface-alt/60 text-xs font-semibold uppercase tracking-wide text-text-dim">
                    <th className="px-4 py-3">Incl.</th>
                    <th className="px-4 py-3">Date</th>
                    <th className="px-4 py-3">Title</th>
                    <th className="px-4 py-3">Type</th>
                    <th className="px-4 py-3 min-w-[200px]">Assign to case</th>
                    <th className="px-4 py-3 min-w-[14rem]">Description</th>
                    <th className="px-4 py-3">Location</th>
                    <th className="px-4 py-3 w-16" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.rowId} className={`border-b border-border ${r.included ? "" : "opacity-50"}`}>
                      <td className="px-4 py-3 align-top">
                        <input
                          type="checkbox"
                          className="h-4 w-4 rounded border-border text-primary"
                          checked={r.included}
                          onChange={(e) => updateRow(r.rowId, { included: e.target.checked })}
                        />
                      </td>
                      <td className="px-4 py-3 align-top">
                        <Input
                          type="date"
                          className="w-[11rem] text-xs"
                          value={r.date}
                          onChange={(e) => updateRow(r.rowId, { date: e.target.value })}
                        />
                        {r.allDay ? (
                          <span className="mt-1 block text-[10px] text-text-dim">All-day</span>
                        ) : (
                          <span className="mt-1 block text-[10px] text-text-dim">Timed</span>
                        )}
                      </td>
                      <td className="px-4 py-3 align-top">
                        <Input
                          className="min-w-[10rem] text-xs"
                          value={r.title}
                          onChange={(e) => updateRow(r.rowId, { title: e.target.value })}
                        />
                      </td>
                      <td className="px-4 py-3 align-top">
                        <Select
                          className="min-w-[11rem] text-xs"
                          value={r.eventKind}
                          onChange={(e) => updateRow(r.rowId, { eventKind: e.target.value as EventKind })}
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
                      </td>
                      <td className="px-4 py-3 align-top">
                        <Select
                          className="min-w-[12rem] max-w-[18rem] text-xs"
                          value={r.assignTo}
                          onChange={(e) => updateRow(r.rowId, { assignTo: e.target.value })}
                        >
                          <option value="">Select case…</option>
                          {existingCases.length > 0 && (
                            <optgroup label="Existing cases">
                              {existingCases.map((c) => (
                                <option key={c.id} value={`existing:${c.id}`}>
                                  {c.name}
                                </option>
                              ))}
                            </optgroup>
                          )}
                          {pendingCases.length > 0 && (
                            <optgroup label="New cases (created on import)">
                              {pendingCases.map((d) => (
                                <option key={d.draftId} value={`draft:${d.draftId}`}>
                                  New: {d.clientName || "(client)"} ({d.caseNumber || "—"})
                                </option>
                              ))}
                            </optgroup>
                          )}
                        </Select>
                      </td>
                      <td className="px-4 py-3 align-top">
                        <Textarea
                          rows={2}
                          className="min-w-[12rem] text-xs"
                          value={r.description}
                          onChange={(e) => updateRow(r.rowId, { description: e.target.value })}
                        />
                      </td>
                      <td className="px-4 py-3 align-top">
                        <Input
                          className="min-w-[10rem] text-xs"
                          value={r.location ?? ""}
                          onChange={(e) =>
                            updateRow(r.rowId, { location: e.target.value.trim() || null })
                          }
                          placeholder="Room / address / URL"
                        />
                      </td>
                      <td className="px-4 py-3 align-top">
                        <button
                          type="button"
                          className="text-xs font-medium text-danger hover:underline"
                          onClick={() => setRows((prev) => prev.filter((x) => x.rowId !== r.rowId))}
                        >
                          Remove
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-4">
              <Link href="/cases" className="text-sm font-medium text-primary hover:underline">
                ← All cases
              </Link>
              <Button variant="pink" disabled={importBusy || includedCount === 0} onClick={() => void runImport()}>
                {importBusy ? "Importing…" : `Import ${includedCount} event(s)`}
              </Button>
            </div>
          </CardBody>
        </Card>
      )}
    </PageWrapper>
  );
}
