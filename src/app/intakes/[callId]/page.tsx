"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { format, parseISO } from "date-fns";
import { useAuth } from "@/context/AuthContext";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { INTAKE_FIELD_SECTIONS } from "@/lib/intake-update";
import type { IntakeFlat, IntakeInteraction } from "@/lib/intake-types";
import { useIntakeApi } from "@/hooks/useIntakeApi";
import { useHydrated } from "@/hooks/useHydrated";
import { PageSkeleton } from "@/components/PageSkeleton";
import {
  Badge,
  Button,
  Card,
  CardBody,
  Input,
  Label,
  PageWrapper,
  Textarea,
} from "@/components/ui";

function formatWhen(iso: string | null): string {
  if (!iso) return "—";
  try {
    return format(parseISO(iso), "MMM d, yyyy h:mm a");
  } catch {
    return iso;
  }
}

function displayValue(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "boolean") return v ? "Yes" : "No";
  return String(v);
}

export default function IntakeDetailPage() {
  const params = useParams();
  const callId = decodeURIComponent(String(params.callId ?? ""));
  const router = useRouter();
  const hydrated = useHydrated();
  const { user, loading, supabaseReady } = useAuth();
  const api = useIntakeApi();

  const [intake, setIntake] = useState<IntakeFlat | null>(null);
  const [interactions, setInteractions] = useState<IntakeInteraction[]>([]);
  const [draft, setDraft] = useState<IntakeFlat | null>(null);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!api.ready || !callId) return;
    setLoadError(null);
    try {
      const data = await api.get<{ intake: IntakeFlat; interactions: IntakeInteraction[] }>(
        `/api/intakes/${encodeURIComponent(callId)}`
      );
      setIntake(data.intake);
      setDraft(data.intake);
      setInteractions(data.interactions);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Failed to load intake");
      setIntake(null);
    }
  }, [api, callId]);

  useEffect(() => {
    if (!supabaseReady || loading || !user) return;
    void load();
  }, [user, loading, supabaseReady, load]);

  useEffect(() => {
    if (!loading && supabaseReady && !user) router.replace("/login");
  }, [user, loading, supabaseReady, router]);

  async function saveEdits() {
    if (!draft) return;
    setBusy(true);
    setMsg(null);
    try {
      const data = await api.patch<{ intake: IntakeFlat }>(
        `/api/intakes/${encodeURIComponent(callId)}`,
        draft
      );
      setIntake(data.intake);
      setDraft(data.intake);
      setEditing(false);
      setMsg("Saved");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Save failed");
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

  if (loadError) {
    return (
      <PageWrapper>
        <Link href="/intakes" className="text-sm font-medium text-primary hover:underline">
          ← Intakes
        </Link>
        <p className="mt-4 text-text-muted">{loadError}</p>
      </PageWrapper>
    );
  }

  if (!intake || !draft) {
    return (
      <PageWrapper>
        <p className="text-text-muted">Loading…</p>
      </PageWrapper>
    );
  }

  const promoted = Boolean(intake.case_id);
  const model = editing ? draft : intake;

  return (
    <PageWrapper>
      <div className="mb-2">
        <Link href="/intakes" className="text-xs font-medium text-text-muted hover:text-primary">
          ← Intakes
        </Link>
      </div>

      <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-text">
            {intake.name?.trim() || "Unnamed intake"}
          </h1>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-text-muted">
            {intake.phone && <span>{intake.phone}</span>}
            {intake.accident_date && (
              <>
                <span className="text-border-strong">·</span>
                <span>Accident {intake.accident_date}</span>
              </>
            )}
            <span className="text-border-strong">·</span>
            <span>{formatWhen(intake.created_at)}</span>
            {promoted ? (
              <Badge variant="success">Promoted</Badge>
            ) : (
              <Badge variant="primary">Open</Badge>
            )}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {intake.quo_link && (
            <a
              href={intake.quo_link}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center rounded-lg border border-border bg-white px-4 py-2 text-sm font-medium text-text shadow-sm hover:bg-surface-alt"
            >
              Open in Quo
            </a>
          )}
          {promoted && intake.case_id ? (
            <Link
              href={`/cases/${intake.case_id}`}
              className="inline-flex items-center justify-center rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-primary-hover"
            >
              View case
            </Link>
          ) : (
            <Link
              href={`/intakes/${encodeURIComponent(callId)}/promote`}
              className="inline-flex items-center justify-center rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-primary-hover"
            >
              Promote to case
            </Link>
          )}
          {!promoted && (
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => {
                if (editing) {
                  setDraft(intake);
                  setEditing(false);
                } else {
                  setEditing(true);
                }
              }}
            >
              {editing ? "Cancel edit" : "Edit fields"}
            </Button>
          )}
          {editing && (
            <Button disabled={busy} onClick={() => void saveEdits()}>
              {busy ? "Saving…" : "Save"}
            </Button>
          )}
        </div>
      </div>

      {msg && (
        <p className="mb-4 rounded-lg border border-border bg-surface-alt px-3 py-2 text-sm text-text-secondary">
          {msg}
        </p>
      )}

      {intake.transcript && (
        <Card className="mb-6">
          <CardBody>
            <h2 className="text-sm font-semibold text-text">Transcript</h2>
            <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-text-secondary">
              {intake.transcript}
            </p>
          </CardBody>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {INTAKE_FIELD_SECTIONS.map((section) => (
          <Card key={section.title}>
            <CardBody>
              <h2 className="mb-3 text-sm font-semibold text-text">{section.title}</h2>
              <dl className="space-y-3">
                {section.fields.map(({ key, label, multiline }) => (
                  <div key={key}>
                    <dt className="text-xs font-medium text-text-muted">{label}</dt>
                    {editing ? (
                      multiline ? (
                        <Textarea
                          className="mt-1"
                          rows={3}
                          value={String(model[key] ?? "")}
                          onChange={(e) =>
                            setDraft({ ...draft, [key]: e.target.value || null } as IntakeFlat)
                          }
                        />
                      ) : (
                        <Input
                          className="mt-1"
                          value={String(model[key] ?? "")}
                          onChange={(e) =>
                            setDraft({ ...draft, [key]: e.target.value || null } as IntakeFlat)
                          }
                        />
                      )
                    ) : (
                      <dd className="mt-0.5 text-sm text-text">{displayValue(intake[key])}</dd>
                    )}
                  </div>
                ))}
              </dl>
            </CardBody>
          </Card>
        ))}
      </div>

      <Card className="mt-6">
        <CardBody>
          <h2 className="text-sm font-semibold text-text">Follow-up communications</h2>
          <p className="mt-1 text-xs text-text-muted">Read-only — managed by the intake router.</p>
          {interactions.length === 0 ? (
            <p className="mt-3 text-sm text-text-muted">No interactions yet.</p>
          ) : (
            <ul className="mt-4 space-y-3">
              {interactions.map((ix) => (
                <li key={ix.id} className="rounded-lg border border-border bg-surface-alt px-3 py-2.5">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-text-muted">
                    <span>{formatWhen(ix.created_at)}</span>
                    {ix.channel && <Badge>{ix.channel}</Badge>}
                    {ix.direction && <span>{ix.direction}</span>}
                  </div>
                  {ix.summary && <p className="mt-1 text-sm font-medium text-text">{ix.summary}</p>}
                  {ix.body && (
                    <p className="mt-1 whitespace-pre-wrap text-sm text-text-secondary">{ix.body}</p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </PageWrapper>
  );
}
