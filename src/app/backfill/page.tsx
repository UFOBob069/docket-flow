"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { getBrowserSupabase } from "@/lib/supabase/singleton";
import { createAdHocCalendarEvent } from "@/lib/event-factory";
import { getRemindersForEventKind } from "@/lib/case-event-kinds";
import { parseCasesImportCsv, CASE_IMPORT_CSV_TEMPLATE } from "@/lib/import-cases-csv";
import {
  parseOtherEventsBackfillCsv,
  parseSolBackfillCsv,
  OTHER_EVENTS_BACKFILL_CSV_TEMPLATE,
  SOL_BACKFILL_CSV_TEMPLATE,
} from "@/lib/backfill-csv";
import {
  createCase,
  fetchCasesForUser,
  fetchContactsForUser,
  logActivity,
  saveEvent,
  updateCase,
} from "@/lib/supabase/repo";
import type { Case, Contact } from "@/lib/types";
import { PageSkeleton } from "@/components/PageSkeleton";
import { useHydrated } from "@/hooks/useHydrated";
import { Button, Card, CardBody, CardHeader, Label, PageWrapper } from "@/components/ui";

type BackfillMode = "cases" | "sol" | "other";
type ImportSummary = {
  mode: BackfillMode;
  processed: number;
  imported: number;
  unmatched: string[];
  errors: string[];
  note?: string;
};

function compactCaseNumber(v: string): string {
  return v.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export default function BackfillPage() {
  const router = useRouter();
  const hydrated = useHydrated();
  const { user, loading, supabaseReady } = useAuth();
  const [busyMode, setBusyMode] = useState<BackfillMode | null>(null);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [cases, setCases] = useState<Case[]>([]);
  const [mode, setMode] = useState<BackfillMode>("cases");
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && supabaseReady && !user) router.replace("/login");
  }, [loading, router, supabaseReady, user]);

  useEffect(() => {
    if (!supabaseReady || loading || !user) return;
    const supabase = getBrowserSupabase();
    let cancelled = false;
    (async () => {
      try {
        const [contactsList, caseList] = await Promise.all([
          fetchContactsForUser(supabase, user.id),
          fetchCasesForUser(supabase, user.id),
        ]);
        if (cancelled) return;
        setContacts(contactsList);
        setCases(caseList);
      } catch (e) {
        if (!cancelled) {
          setErr(e instanceof Error ? e.message : "Failed to load data.");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loading, supabaseReady, user]);

  const caseByNumber = useMemo(() => {
    const m = new Map<string, Case>();
    for (const c of cases) {
      const raw = c.caseNumber?.trim() || c.causeNumber?.trim() || "";
      if (!raw) continue;
      m.set(compactCaseNumber(raw), c);
    }
    return m;
  }, [cases]);

  async function refreshCases() {
    if (!user) return;
    const supabase = getBrowserSupabase();
    const caseList = await fetchCasesForUser(supabase, user.id);
    setCases(caseList);
  }

  async function runCaseBackfill(file: File | null) {
    if (!user || !file) return;
    setBusyMode("cases");
    setSummary(null);
    setErr(null);
    try {
      const text = await file.text();
      const parsed = parseCasesImportCsv(text, contacts);
      if (!parsed.rows.length) {
        setSummary({
          mode: "cases",
          processed: 0,
          imported: 0,
          unmatched: [],
          errors: parsed.errors.length ? parsed.errors : ["No valid case rows found."],
        });
        return;
      }
      const supabase = getBrowserSupabase();
      const existingMap = new Map<string, Case>(caseByNumber.entries());
      let created = 0;
      let updated = 0;
      for (const row of parsed.rows) {
        const key = compactCaseNumber(row.caseNumber);
        const existing = existingMap.get(key);
        const name = `${row.clientName.trim()} (${row.caseNumber.trim()})`;
        if (existing) {
          await updateCase(supabase, existing.id, {
            name,
            clientName: row.clientName.trim(),
            caseNumber: row.caseNumber.trim(),
            causeNumber: row.caseNumber.trim(),
            dateOfIncident: row.dateOfIncident || null,
            assignedContactIds: [row.attorneyId, row.paralegalId],
          });
          updated++;
        } else {
          const id = await createCase(supabase, user.id, {
            name,
            clientName: row.clientName.trim(),
            caseNumber: row.caseNumber.trim(),
            causeNumber: row.caseNumber.trim(),
            dateOfIncident: row.dateOfIncident || null,
            assignedContactIds: [row.attorneyId, row.paralegalId],
          });
          existingMap.set(key, {
            id,
            ownerId: user.id,
            name,
            clientName: row.clientName.trim(),
            caseNumber: row.caseNumber.trim(),
            causeNumber: row.caseNumber.trim(),
            status: "active",
            assignedContactIds: [row.attorneyId, row.paralegalId],
            createdAt: Date.now(),
            updatedAt: Date.now(),
            dateOfIncident: row.dateOfIncident || null,
          });
          created++;
        }
      }
      await logActivity(supabase, user.id, {
        action: "case_created",
        description: `Backfill cases upload: ${created} created, ${updated} updated`,
        userEmail: user.email ?? "",
      });
      await refreshCases();
      setSummary({
        mode: "cases",
        processed: parsed.rows.length,
        imported: created + updated,
        unmatched: [],
        errors: parsed.errors,
        note: `${created} created, ${updated} updated.`,
      });
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Case backfill failed.");
    } finally {
      setBusyMode(null);
    }
  }

  async function runSolBackfill(file: File | null) {
    if (!user || !file) return;
    setBusyMode("sol");
    setSummary(null);
    setErr(null);
    try {
      const text = await file.text();
      const parsed = parseSolBackfillCsv(text);
      if (!parsed.rows.length) {
        setSummary({
          mode: "sol",
          processed: 0,
          imported: 0,
          unmatched: [],
          errors: parsed.errors.length ? parsed.errors : ["No valid SOL rows found."],
        });
        return;
      }
      const supabase = getBrowserSupabase();
      const unmatched: string[] = [];
      let imported = 0;
      for (const row of parsed.rows) {
        const c = caseByNumber.get(compactCaseNumber(row.caseNumber));
        if (!c) {
          unmatched.push(`Case #${row.caseNumber} not found`);
          continue;
        }
        const event = createAdHocCalendarEvent(c.id, user.id, {
          eventDate: row.solDate,
          eventKind: row.eventKind,
          title: row.title,
          description: row.description,
          remindersMinutes: [...getRemindersForEventKind(row.eventKind)],
          createdByEmail: user.email?.trim() ?? null,
        });
        await saveEvent(supabase, c.id, event);
        imported++;
      }
      await logActivity(supabase, user.id, {
        action: "event_created",
        description: `Backfill SOL upload: ${imported} event(s) added (no Google sync)`,
        userEmail: user.email ?? "",
      });
      setSummary({
        mode: "sol",
        processed: parsed.rows.length,
        imported,
        unmatched,
        errors: parsed.errors,
        note: "UI-only import complete (no Google Calendar sync).",
      });
    } catch (e) {
      setErr(e instanceof Error ? e.message : "SOL backfill failed.");
    } finally {
      setBusyMode(null);
    }
  }

  async function runOtherEventsBackfill(file: File | null) {
    if (!user || !file) return;
    setBusyMode("other");
    setSummary(null);
    setErr(null);
    try {
      const text = await file.text();
      const parsed = parseOtherEventsBackfillCsv(text);
      if (!parsed.rows.length) {
        setSummary({
          mode: "other",
          processed: 0,
          imported: 0,
          unmatched: [],
          errors: parsed.errors.length ? parsed.errors : ["No valid event rows found."],
        });
        return;
      }
      const supabase = getBrowserSupabase();
      const unmatched: string[] = [];
      let imported = 0;
      for (const row of parsed.rows) {
        const c = caseByNumber.get(compactCaseNumber(row.caseNumber));
        if (!c) {
          unmatched.push(`Case #${row.caseNumber} not found`);
          continue;
        }
        const event = createAdHocCalendarEvent(c.id, user.id, {
          eventDate: row.eventDate,
          startTime: row.startTime || null,
          endTime: row.endTime || null,
          eventKind: row.eventKind,
          title: row.title,
          description: row.description,
          remindersMinutes: [...getRemindersForEventKind(row.eventKind)],
          createdByEmail: user.email?.trim() ?? null,
        });
        await saveEvent(supabase, c.id, event);
        imported++;
      }
      await logActivity(supabase, user.id, {
        action: "event_created",
        description: `Backfill other events upload: ${imported} event(s) added (no Google sync)`,
        userEmail: user.email ?? "",
      });
      setSummary({
        mode: "other",
        processed: parsed.rows.length,
        imported,
        unmatched,
        errors: parsed.errors,
        note: "UI-only import complete (no Google Calendar sync).",
      });
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Other events backfill failed.");
    } finally {
      setBusyMode(null);
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

  return (
    <PageWrapper>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-text">Backfill Imports</h1>
        <p className="mt-2 max-w-3xl text-sm text-text-muted">
          Use three separate uploads: first Cases, then Statute of Limitations, then Other Events. SOL and Other
          imports are UI-only and do not create or update Google Calendar entries.
        </p>
      </div>

      <div className="mb-6 flex flex-wrap gap-2">
        <Button type="button" variant={mode === "cases" ? "pink" : "secondary"} onClick={() => setMode("cases")}>
          1) Cases
        </Button>
        <Button type="button" variant={mode === "sol" ? "pink" : "secondary"} onClick={() => setMode("sol")}>
          2) Statute of Limitations
        </Button>
        <Button type="button" variant={mode === "other" ? "pink" : "secondary"} onClick={() => setMode("other")}>
          3) Other Events
        </Button>
      </div>

      {err && (
        <div className="mb-6 rounded-lg border border-danger/20 bg-danger-light px-4 py-3 text-sm text-danger" role="alert">
          {err}
        </div>
      )}

      {summary && (
        <div className="mb-6 rounded-lg border border-primary/20 bg-primary-light px-4 py-3 text-sm text-primary">
          <p>
            Processed {summary.processed}, imported {summary.imported}
            {summary.note ? ` — ${summary.note}` : "."}
          </p>
          {summary.unmatched.length > 0 && (
            <p className="mt-1 text-xs text-text-secondary">
              Unmatched case numbers ({summary.unmatched.length}): {summary.unmatched.slice(0, 5).join("; ")}
              {summary.unmatched.length > 5 ? "; ..." : ""}
            </p>
          )}
          {summary.errors.length > 0 && (
            <p className="mt-1 text-xs text-text-secondary">
              Validation issues ({summary.errors.length}): {summary.errors.slice(0, 4).join(" ")}
              {summary.errors.length > 4 ? " ..." : ""}
            </p>
          )}
        </div>
      )}

      {mode === "cases" && (
        <Card>
          <CardHeader>
            <h2 className="text-base font-semibold text-text">Case Upload</h2>
            <p className="mt-1 text-sm text-text-muted">
              Required columns: case number, client name, attorney, paralegal. This creates or updates cases by case
              number.
            </p>
          </CardHeader>
          <CardBody className="space-y-3">
            <Label>CSV file</Label>
            <input
              type="file"
              accept=".csv,text/csv"
              className="block max-w-full cursor-pointer text-sm file:mr-3 file:rounded-md file:border-0 file:bg-primary-light file:px-3 file:py-1 file:text-xs file:font-semibold file:text-primary"
              disabled={busyMode !== null}
              onChange={(e) => void runCaseBackfill(e.target.files?.[0] ?? null)}
            />
            <a
              href={`data:text/csv;charset=utf-8,${encodeURIComponent(CASE_IMPORT_CSV_TEMPLATE)}`}
              download="backfill-cases-template.csv"
              className="text-xs font-medium text-primary hover:underline"
            >
              Download case template
            </a>
          </CardBody>
        </Card>
      )}

      {mode === "sol" && (
        <Card>
          <CardHeader>
            <h2 className="text-base font-semibold text-text">Statute of Limitations Backfill</h2>
            <p className="mt-1 text-sm text-text-muted">
              Matches by case number. Adds events to DocketFlow only (no Google sync).
            </p>
          </CardHeader>
          <CardBody className="space-y-3">
            <Label>CSV file</Label>
            <input
              type="file"
              accept=".csv,text/csv"
              className="block max-w-full cursor-pointer text-sm file:mr-3 file:rounded-md file:border-0 file:bg-primary-light file:px-3 file:py-1 file:text-xs file:font-semibold file:text-primary"
              disabled={busyMode !== null}
              onChange={(e) => void runSolBackfill(e.target.files?.[0] ?? null)}
            />
            <a
              href={`data:text/csv;charset=utf-8,${encodeURIComponent(SOL_BACKFILL_CSV_TEMPLATE)}`}
              download="backfill-sol-template.csv"
              className="text-xs font-medium text-primary hover:underline"
            >
              Download SOL template
            </a>
          </CardBody>
        </Card>
      )}

      {mode === "other" && (
        <Card>
          <CardHeader>
            <h2 className="text-base font-semibold text-text">Other Events Backfill</h2>
            <p className="mt-1 text-sm text-text-muted">
              Matches by case number. Supports all-day or timed entries and stores them only in DocketFlow.
            </p>
          </CardHeader>
          <CardBody className="space-y-3">
            <Label>CSV file</Label>
            <input
              type="file"
              accept=".csv,text/csv"
              className="block max-w-full cursor-pointer text-sm file:mr-3 file:rounded-md file:border-0 file:bg-primary-light file:px-3 file:py-1 file:text-xs file:font-semibold file:text-primary"
              disabled={busyMode !== null}
              onChange={(e) => void runOtherEventsBackfill(e.target.files?.[0] ?? null)}
            />
            <a
              href={`data:text/csv;charset=utf-8,${encodeURIComponent(OTHER_EVENTS_BACKFILL_CSV_TEMPLATE)}`}
              download="backfill-other-events-template.csv"
              className="text-xs font-medium text-primary hover:underline"
            >
              Download other-events template
            </a>
          </CardBody>
        </Card>
      )}
    </PageWrapper>
  );
}
