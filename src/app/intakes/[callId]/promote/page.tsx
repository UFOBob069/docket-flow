"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { getBrowserSupabase } from "@/lib/supabase/singleton";
import { CASE_TYPE_OPTIONS, isCaseType } from "@/lib/case-types";
import { isPreferredLanguage, PREFERRED_LANGUAGE_OPTIONS } from "@/lib/preferred-languages";
import { formatUsPhoneDisplay } from "@/lib/phone-format";
import { quoContactDisplayLabel } from "@/lib/client-name";
import { intakePrefillForPromote } from "@/lib/intake-promote";
import type { IntakeFlat, IntakePromoteBody } from "@/lib/intake-types";
import { subscribeContacts } from "@/lib/supabase/repo";
import { adjustSolWeekendToFriday, statuteLimitDateIsoForCalendar } from "@/lib/sol";
import { DEFAULT_REMINDERS } from "@/lib/reminder-presets";
import { buildSolMilestoneSpecs } from "@/lib/sol-milestones";
import { digitsOnlyCaseNumberInput, isValidNumericCaseNumber } from "@/lib/case-display";
import type { Contact } from "@/lib/types";
import { useIntakeApi } from "@/hooks/useIntakeApi";
import { useHydrated } from "@/hooks/useHydrated";
import { PageSkeleton } from "@/components/PageSkeleton";
import { DateInput } from "@/components/DateInput";
import { ReminderMinutesEditor } from "@/components/ReminderMinutesEditor";
import {
  Button,
  Card,
  CardBody,
  Input,
  Label,
  PageWrapper,
  Select,
  Textarea,
} from "@/components/ui";

export default function PromoteIntakePage() {
  const params = useParams();
  const callId = decodeURIComponent(String(params.callId ?? ""));
  const router = useRouter();
  const hydrated = useHydrated();
  const { user, loading, supabaseReady } = useAuth();
  const api = useIntakeApi();

  const [intake, setIntake] = useState<IntakeFlat | null>(null);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [caseNumber, setCaseNumber] = useState("");
  const [clientFirstName, setClientFirstName] = useState("");
  const [clientLastName, setClientLastName] = useState("");
  const [clientAlreadyInQuo, setClientAlreadyInQuo] = useState<"" | "yes" | "no">("");
  const [clientPhone, setClientPhone] = useState("");
  const [preferredLanguage, setPreferredLanguage] = useState("");
  const [secondaryLanguage, setSecondaryLanguage] = useState("");
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [dateOfIncident, setDateOfIncident] = useState("");
  const [caseType, setCaseType] = useState("");
  const [injuries, setInjuries] = useState("");
  const [caseDescription, setCaseDescription] = useState("");
  const [notes, setNotes] = useState("");
  const [attorneyId, setAttorneyId] = useState("");
  const [eventAttorneyId, setEventAttorneyId] = useState("");
  const [paralegalId, setParalegalId] = useState("");
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
    if (!api.ready || !callId) return;
    void (async () => {
      try {
        const data = await api.get<{ intake: IntakeFlat }>(
          `/api/intakes/${encodeURIComponent(callId)}`
        );
        const row = data.intake;
        setIntake(row);
        if (row.case_id) return;
        const pre = intakePrefillForPromote(row);
        setClientFirstName(pre.clientFirstName);
        setClientLastName(pre.clientLastName);
        setClientPhone(formatUsPhoneDisplay(pre.clientPhone));
        setDateOfBirth(pre.dateOfBirth);
        setDateOfIncident(pre.dateOfIncident);
        setNotes(pre.notes);
        setInjuries(pre.injuries);
        setCaseDescription(pre.caseDescription);
        if (pre.clientPhone.trim()) setClientAlreadyInQuo("no");
      } catch (e) {
        setErr(e instanceof Error ? e.message : "Failed to load intake");
      }
    })();
  }, [api, callId]);

  useEffect(() => {
    if (!dateOfIncident) {
      setSolDate("");
      return;
    }
    setSolDate(statuteLimitDateIsoForCalendar(dateOfIncident, 2));
  }, [dateOfIncident]);

  useEffect(() => {
    if (!loading && supabaseReady && !user) router.replace("/login");
  }, [user, loading, supabaseReady, router]);

  const attorneys = useMemo(() => contacts.filter((c) => c.role === "attorney"), [contacts]);
  const paralegals = useMemo(() => contacts.filter((c) => c.role === "paralegal"), [contacts]);

  const solMilestonePreview = useMemo(() => {
    const doi = dateOfIncident.trim();
    const sol = (solDate || (doi ? statuteLimitDateIsoForCalendar(doi, 2) : "")).slice(0, 10);
    if (!doi || !sol) return [];
    try {
      return buildSolMilestoneSpecs(sol, doi, solRemindersMinutes).map((s) => ({
        date: s.date,
        line: s.googleSummaryStem,
      }));
    } catch {
      return [];
    }
  }, [dateOfIncident, solDate, solRemindersMinutes]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!intake || intake.case_id) return;
    const cn = caseNumber.trim();
    if (!isValidNumericCaseNumber(cn)) {
      setErr("Case number must contain digits only.");
      return;
    }
    if (!clientAlreadyInQuo) {
      setErr("Indicate whether this client is already in Quo.");
      return;
    }

    const body: IntakePromoteBody = {
      caseNumber: cn,
      responsibleAttorneyContactId: attorneyId,
      paralegalContactId: paralegalId,
      eventAttorneyContactId: eventAttorneyId || null,
      preferredLanguage,
      secondaryLanguage: secondaryLanguage || null,
      caseType,
      clientAlreadyInQuo,
      clientPhone: clientAlreadyInQuo === "no" ? clientPhone : undefined,
      clientFirstName,
      clientLastName,
      dateOfBirth,
      dateOfIncident,
      notes,
      injuries,
      caseDescription,
      solDate: adjustSolWeekendToFriday(solDate || statuteLimitDateIsoForCalendar(dateOfIncident, 2)),
      solRemindersMinutes,
    };

    setBusy(true);
    setErr(null);
    try {
      const res = await api.post<{ caseId: string }>(
        `/api/intakes/${encodeURIComponent(callId)}/promote`,
        body
      );
      router.push(`/cases/${res.caseId}`);
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : "Promote failed");
    } finally {
      setBusy(false);
    }
  }

  if (!hydrated) return <PageSkeleton />;
  if (!isSupabaseConfigured()) {
    return (
      <PageWrapper>
        <p className="text-text-muted">Configure Supabase.</p>
      </PageWrapper>
    );
  }
  if (!user) return null;

  if (intake?.case_id) {
    return (
      <PageWrapper>
        <Link href={`/intakes/${encodeURIComponent(callId)}`} className="text-sm text-primary hover:underline">
          ← Intake
        </Link>
        <p className="mt-4 text-text-muted">This intake was already promoted.</p>
        <Link href={`/cases/${intake.case_id}`} className="mt-2 inline-block text-sm font-medium text-primary">
          View case →
        </Link>
      </PageWrapper>
    );
  }

  return (
    <PageWrapper>
      <div className="mb-6">
        <Link
          href={`/intakes/${encodeURIComponent(callId)}`}
          className="text-xs font-medium text-text-muted hover:text-primary"
        >
          ← Intake detail
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-text">Promote to case</h1>
        <p className="mt-1 text-sm text-text-muted">
          Creates the case, Case Tracker entry (with filled intake fields), and SOL milestones. Intake fields already
          on the call are copied into tracker where they fit.
        </p>
      </div>

      <form onSubmit={(e) => void handleSubmit(e)}>
        <Card>
          <CardBody className="space-y-5">
            {err && (
              <p className="rounded-lg border border-danger/30 bg-danger-light px-3 py-2 text-sm text-danger">
                {err}
              </p>
            )}
            <div>
              <Label required>Case number</Label>
              <Input
                className="mt-1.5"
                value={caseNumber}
                onChange={(e) => setCaseNumber(digitsOnlyCaseNumberInput(e.target.value))}
                required
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label required>Client first name</Label>
                <Input
                  className="mt-1.5"
                  value={clientFirstName}
                  onChange={(e) => setClientFirstName(e.target.value)}
                  required
                />
              </div>
              <div>
                <Label required>Client last name</Label>
                <Input
                  className="mt-1.5"
                  value={clientLastName}
                  onChange={(e) => setClientLastName(e.target.value)}
                  required
                />
              </div>
            </div>
            <div>
              <Label required>Contact already in Quo?</Label>
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setClientAlreadyInQuo("yes");
                    setClientPhone("");
                  }}
                  className={`rounded-lg border px-4 py-2 text-sm font-medium ${
                    clientAlreadyInQuo === "yes"
                      ? "border-primary bg-primary-light text-primary"
                      : "border-border bg-white"
                  }`}
                >
                  Yes
                </button>
                <button
                  type="button"
                  onClick={() => setClientAlreadyInQuo("no")}
                  className={`rounded-lg border px-4 py-2 text-sm font-medium ${
                    clientAlreadyInQuo === "no"
                      ? "border-primary bg-primary-light text-primary"
                      : "border-border bg-white"
                  }`}
                >
                  No — create in Quo
                </button>
              </div>
            </div>
            {clientAlreadyInQuo === "no" && (
              <div>
                <Label required>Client phone</Label>
                <Input
                  className="mt-1.5"
                  value={clientPhone}
                  onChange={(e) => setClientPhone(formatUsPhoneDisplay(e.target.value))}
                  required
                />
                <p className="mt-1 text-xs text-text-muted">
                  Quo: {quoContactDisplayLabel(clientFirstName || "First", clientLastName || "Last", caseNumber || "case#")}
                </p>
              </div>
            )}
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label required>Primary language</Label>
                <Select
                  className="mt-1.5"
                  value={preferredLanguage}
                  onChange={(e) => setPreferredLanguage(e.target.value)}
                  required
                >
                  <option value="">Select…</option>
                  {PREFERRED_LANGUAGE_OPTIONS.map((lang) => (
                    <option key={lang} value={lang}>
                      {lang}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <Label>Secondary language</Label>
                <Select
                  className="mt-1.5"
                  value={secondaryLanguage}
                  onChange={(e) => setSecondaryLanguage(e.target.value)}
                >
                  <option value="">None</option>
                  {PREFERRED_LANGUAGE_OPTIONS.map((lang) => (
                    <option key={lang} value={lang}>
                      {lang}
                    </option>
                  ))}
                </Select>
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label required>Date of birth</Label>
                <DateInput className="mt-1.5" value={dateOfBirth} onChange={setDateOfBirth} required />
              </div>
              <div>
                <Label required>Date of incident</Label>
                <DateInput className="mt-1.5" value={dateOfIncident} onChange={setDateOfIncident} required />
              </div>
            </div>
            <div>
              <Label required>Case type</Label>
              <Select
                className="mt-1.5"
                value={caseType}
                onChange={(e) => setCaseType(e.target.value)}
                required
              >
                <option value="">Select…</option>
                {CASE_TYPE_OPTIONS.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label required>Injuries (→ Case Tracker)</Label>
              <Textarea
                className="mt-1.5"
                rows={3}
                value={injuries}
                onChange={(e) => setInjuries(e.target.value)}
                required
              />
            </div>
            <div>
              <Label required>Case description (→ Case Tracker)</Label>
              <Textarea
                className="mt-1.5"
                rows={4}
                value={caseDescription}
                onChange={(e) => setCaseDescription(e.target.value)}
                required
              />
              <p className="mt-1 text-xs text-text-muted">
                Insurance, property damage, employment, and other intake sections are also copied into Case Tracker on
                promote when filled.
              </p>
            </div>
            <div>
              <Label>Case notes</Label>
              <Textarea className="mt-1.5" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
            <div>
              <Label required>Main attorney</Label>
              <Select className="mt-1.5" value={attorneyId} onChange={(e) => setAttorneyId(e.target.value)} required>
                <option value="">Select…</option>
                {attorneys.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label>Event attorney</Label>
              <Select
                className="mt-1.5"
                value={eventAttorneyId}
                onChange={(e) => setEventAttorneyId(e.target.value)}
              >
                <option value="">Same as main</option>
                {attorneys.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label required>Paralegal</Label>
              <Select className="mt-1.5" value={paralegalId} onChange={(e) => setParalegalId(e.target.value)} required>
                <option value="">Select…</option>
                {paralegals.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label>Statute of limitations</Label>
              <DateInput className="mt-1.5" value={solDate} onChange={setSolDate} />
            </div>
            {solMilestonePreview.length > 0 && (
              <ul className="list-inside list-disc text-xs text-text-muted">
                {solMilestonePreview.map((m) => (
                  <li key={m.date}>
                    {m.date} — {m.line}
                  </li>
                ))}
              </ul>
            )}
            <ReminderMinutesEditor value={solRemindersMinutes} onChange={setSolRemindersMinutes} />
            <div className="flex gap-3 pt-2">
              <Button type="submit" disabled={busy}>
                {busy ? "Creating case…" : "Promote to case"}
              </Button>
              <Link href={`/intakes/${encodeURIComponent(callId)}`}>
                <Button type="button" variant="secondary">
                  Cancel
                </Button>
              </Link>
            </div>
          </CardBody>
        </Card>
      </form>
    </PageWrapper>
  );
}
