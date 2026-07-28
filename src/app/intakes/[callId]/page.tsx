"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { INTAKE_DETAIL_SECTIONS } from "@/lib/intake-detail";
import type { IntakeFlat, IntakeInteraction } from "@/lib/intake-types";
import { useIntakeApi } from "@/hooks/useIntakeApi";
import { useHydrated } from "@/hooks/useHydrated";
import { PageSkeleton } from "@/components/PageSkeleton";
import { PageWrapper } from "@/components/ui";
import { IntakeHeader } from "@/components/intake/IntakeHeader";
import { CaseOverviewCard } from "@/components/intake/CaseOverviewCard";
import { CaseReviewPanel } from "@/components/intake/CaseReviewPanel";
import { MissingInformationCard } from "@/components/intake/MissingInformationCard";
import { NextStepsCard } from "@/components/intake/NextStepsCard";
import { IntakeSection } from "@/components/intake/IntakeSection";
import { TranscriptAccordion } from "@/components/intake/TranscriptAccordion";
import { InternalNotes } from "@/components/intake/InternalNotes";
import { ActivityTimeline } from "@/components/intake/ActivityTimeline";

function intakesEqual(a: IntakeFlat, b: IntakeFlat): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
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
  const [highlightedKey, setHighlightedKey] = useState<keyof IntakeFlat | null>(null);
  const notesRef = useRef<HTMLDivElement>(null);

  const dirty = useMemo(() => {
    if (!intake || !draft) return false;
    return !intakesEqual(intake, draft);
  }, [intake, draft]);

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
      setHighlightedKey(null);
      setMsg("Saved");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  function onFieldChange(key: keyof IntakeFlat, value: string | boolean | null) {
    setDraft((prev) => (prev ? ({ ...prev, [key]: value } as IntakeFlat) : prev));
  }

  function startEdit() {
    if (intake?.case_id) return;
    setDraft(intake);
    setEditing(true);
  }

  function cancelEdit() {
    setDraft(intake);
    setEditing(false);
    setHighlightedKey(null);
  }

  function jumpToField(key: keyof IntakeFlat) {
    if (!intake?.case_id) {
      setDraft(intake);
      setEditing(true);
    }
    setHighlightedKey(key);
    window.requestAnimationFrame(() => {
      const el = document.getElementById(`field-${String(key)}`);
      el?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  }

  function scrollToNotes() {
    if (!intake?.case_id) {
      setDraft(intake);
      setEditing(true);
    }
    window.requestAnimationFrame(() => {
      notesRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      notesRef.current?.focus();
    });
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

  return (
    <div className="min-h-screen bg-[#f4f5f7]">
      <IntakeHeader
        intake={intake}
        callId={callId}
        editing={editing}
        busy={busy}
        dirty={dirty}
        onToggleEdit={startEdit}
        onSave={() => void saveEdits()}
        onCancelEdit={cancelEdit}
      />

      <div className="mx-auto max-w-[1280px] px-4 py-5 sm:px-6 lg:px-8">
        {msg && (
          <p
            className="mb-4 rounded-xl border border-border bg-white px-3 py-2 text-sm text-text-secondary"
            role="status"
          >
            {msg}
          </p>
        )}

        <div className="grid grid-cols-1 gap-5 md:grid-cols-12">
          {/* Main column */}
          <div className="space-y-5 md:col-span-7 lg:col-span-8">
            <CaseOverviewCard intake={editing ? draft : intake} />

            {/* Sidebar stack on mobile — after overview */}
            <div className="space-y-4 md:hidden">
              <CaseReviewPanel intake={intake} callId={callId} />
              <MissingInformationCard
                intake={editing ? draft : intake}
                editing={editing}
                onEditField={jumpToField}
              />
              <NextStepsCard
                intake={intake}
                interactions={interactions}
                onScrollToNotes={scrollToNotes}
              />
            </div>

            <section aria-label="Detailed intake information" className="space-y-3">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-text-muted">
                Detailed information
              </h2>
              {INTAKE_DETAIL_SECTIONS.map((section) => (
                <IntakeSection
                  key={section.id}
                  section={section}
                  intake={intake}
                  draft={draft}
                  editing={editing}
                  defaultOpen={Boolean(section.critical) || section.id === "client"}
                  highlightedKey={highlightedKey}
                  onChange={onFieldChange}
                />
              ))}
            </section>

            <TranscriptAccordion intake={intake} />

            <InternalNotes
              intake={intake}
              draft={draft}
              editing={editing}
              busy={busy}
              notesRef={notesRef}
              onStartEdit={startEdit}
              onChangeNotes={(v) => onFieldChange("notes", v)}
              onSave={() => void saveEdits()}
            />

            <ActivityTimeline intake={intake} interactions={interactions} />
          </div>

          {/* Desktop / tablet sticky sidebar */}
          <aside className="hidden md:col-span-5 md:block lg:col-span-4">
            <div className="sticky top-[130px] space-y-4">
              <CaseReviewPanel intake={intake} callId={callId} />
              <MissingInformationCard
                intake={editing ? draft : intake}
                editing={editing}
                onEditField={jumpToField}
              />
              <NextStepsCard
                intake={intake}
                interactions={interactions}
                onScrollToNotes={scrollToNotes}
              />
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}
