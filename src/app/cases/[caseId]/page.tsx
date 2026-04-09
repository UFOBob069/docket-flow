"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { getDb } from "@/lib/firebase/client";
import { isFirebaseConfigured } from "@/lib/firebase/config";
import {
  deleteCaseCascade,
  deleteEvent,
  saveEvent,
  subscribeCase,
  subscribeEvents,
  updateCase,
} from "@/lib/firestore/repo";
import type { CalendarEvent, Case, CaseStatus, EventCategory } from "@/lib/types";
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
  Textarea,
} from "@/components/ui";

const catBadge: Record<EventCategory, "trial" | "discovery" | "motions" | "pretrial" | "mediation" | "experts" | "other"> = {
  trial: "trial",
  discovery: "discovery",
  motions: "motions",
  pretrial: "pretrial",
  mediation: "mediation",
  experts: "experts",
  other: "other",
};

async function calendarApi(
  body: unknown,
  idToken: string | null
): Promise<Response> {
  return fetch("/api/calendar/sync", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

export default function CaseDetailPage() {
  const params = useParams();
  const caseId = params.caseId as string;
  const router = useRouter();
  const hydrated = useHydrated();
  const { user, loading, idToken, firebaseReady } = useAuth();
  const [c, setC] = useState<Case | null | undefined>(undefined);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [editing, setEditing] = useState<CalendarEvent | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!firebaseReady || loading || !user || !caseId) return;
    const db = getDb();
    const u1 = subscribeCase(db, caseId, (docSnap) => {
      setC(docSnap);
    });
    const u2 = subscribeEvents(db, caseId, setEvents);
    return () => {
      u1();
      u2();
    };
  }, [user, loading, firebaseReady, caseId]);

  useEffect(() => {
    if (!loading && firebaseReady && !user) router.replace("/login");
  }, [user, loading, firebaseReady, router]);

  if (!hydrated) return <PageSkeleton />;

  async function setStatus(status: CaseStatus) {
    if (!caseId) return;
    const db = getDb();
    await updateCase(db, caseId, { status });
  }

  async function removeEvent(ev: CalendarEvent) {
    if (!caseId) return;
    setBusy(true);
    setMsg(null);
    try {
      if (ev.googleEventId) {
        const res = await calendarApi(
          { action: "delete", googleEventId: ev.googleEventId },
          idToken
        );
        if (!res.ok) {
          const j = (await res.json()) as { error?: string };
          throw new Error(j.error ?? "Calendar delete failed");
        }
      }
      const db = getDb();
      await deleteEvent(db, caseId, ev.id);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setBusy(false);
    }
  }

  async function destroyCase() {
    if (!caseId || !c) return;
    if (!confirm("Delete this case and all events from DocketFlow and Google?"))
      return;
    setBusy(true);
    setMsg(null);
    try {
      for (const ev of events) {
        if (ev.googleEventId) {
          const res = await calendarApi(
            { action: "delete", googleEventId: ev.googleEventId },
            idToken
          );
          if (!res.ok) {
            const j = (await res.json()) as { error?: string };
            throw new Error(j.error ?? "Calendar delete failed");
          }
        }
      }
      const db = getDb();
      await deleteCaseCascade(db, caseId);
      router.push("/cases");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Could not delete case");
    } finally {
      setBusy(false);
    }
  }

  async function saveEdit() {
    if (!editing || !caseId || !c) return;
    setBusy(true);
    setMsg(null);
    try {
      const db = getDb();
      const updated: CalendarEvent = {
        ...editing,
        updatedAt: Date.now(),
      };
      await saveEvent(db, caseId, updated);
      if (updated.googleEventId) {
        const res = await calendarApi(
          {
            action: "update",
            googleEventId: updated.googleEventId,
            caseName: c.name,
            title: updated.title,
            date: updated.date,
            description: updated.description,
            reminderMinutes: updated.remindersMinutes,
          },
          idToken
        );
        if (!res.ok) {
          const j = (await res.json()) as { error?: string };
          throw new Error(j.error ?? "Calendar update failed");
        }
      }
      setEditing(null);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  if (!isFirebaseConfigured()) {
    return (
      <PageWrapper>
        <p className="text-text-muted">Configure Firebase.</p>
      </PageWrapper>
    );
  }

  if (!user) return null;

  if (c === undefined) {
    return (
      <PageWrapper>
        <p className="text-text-muted">Loading…</p>
      </PageWrapper>
    );
  }

  if (c === null) {
    return (
      <PageWrapper>
        <p className="text-text-muted">Case not found.</p>
        <Link href="/cases" className="mt-4 inline-block text-sm font-medium text-primary hover:underline">
          ← All Cases
        </Link>
      </PageWrapper>
    );
  }

  return (
    <PageWrapper>
      {/* Breadcrumb + header */}
      <div className="mb-2">
        <Link href="/cases" className="text-xs font-medium text-text-muted hover:text-primary">
          ← All Cases
        </Link>
      </div>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-text lg:text-3xl">
            {c.name}
          </h1>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-text-muted">
            <span>{c.clientName}</span>
            {c.causeNumber && (
              <>
                <span className="text-border-strong">·</span>
                <span>Cause {c.causeNumber}</span>
              </>
            )}
            {c.court && (
              <>
                <span className="text-border-strong">·</span>
                <span>{c.court}</span>
              </>
            )}
            <Badge variant={c.status === "active" ? "success" : "default"}>
              {c.status}
            </Badge>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            size="sm"
            disabled={busy}
            onClick={() => void setStatus(c.status === "active" ? "archived" : "active")}
          >
            Mark {c.status === "active" ? "archived" : "active"}
          </Button>
          <Button
            variant="danger"
            size="sm"
            disabled={busy}
            onClick={() => void destroyCase()}
          >
            Delete case
          </Button>
        </div>
      </div>

      {c.documentUrl && (
        <div className="mt-4">
          <a
            href={c.documentUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m.75 12l3 3m0 0l3-3m-3 3v-6m-1.5-9H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
            </svg>
            Source document{c.documentFileName ? `: ${c.documentFileName}` : ""}
          </a>
        </div>
      )}

      {msg && (
        <div className="mt-4 rounded-lg border border-danger/20 bg-danger-light px-4 py-3" role="alert">
          <p className="text-sm text-danger">{msg}</p>
        </div>
      )}

      {/* Timeline */}
      <Card className="mt-8">
        <CardHeader>
          <h2 className="text-base font-semibold text-text">Timeline</h2>
        </CardHeader>
        <CardBody className="p-0">
          {events.length === 0 ? (
            <div className="px-6 py-10 text-center text-sm text-text-muted">
              No events on this case.
            </div>
          ) : (
            <div className="divide-y divide-border">
              {events.map((ev) => (
                <div key={ev.id} className="flex gap-4 px-6 py-4">
                  <div className="flex flex-col items-center pt-0.5">
                    <div className={`h-3 w-3 rounded-full ${ev.googleEventId ? "bg-primary ring-4 ring-primary-light" : "bg-border-strong"}`} />
                    <div className="mt-1 flex-1 w-px bg-border" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold tabular-nums text-text">
                        {ev.date}
                      </span>
                      <Badge variant={catBadge[ev.category]}>
                        {ev.category}
                      </Badge>
                      {ev.googleEventId && (
                        <Badge variant="success">Synced</Badge>
                      )}
                      {ev.noiseFlag && (
                        <Badge variant="warning">
                          {ev.noiseReason ?? "Noise"}
                        </Badge>
                      )}
                    </div>
                    <p className="mt-1 text-sm font-medium text-text">
                      {ev.title}
                    </p>
                    {ev.description && (
                      <p className="mt-0.5 text-sm text-text-muted line-clamp-2">
                        {ev.description}
                      </p>
                    )}
                    <div className="mt-2 flex gap-3">
                      <button
                        type="button"
                        className="text-xs font-medium text-primary hover:underline"
                        onClick={() => setEditing({ ...ev })}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className="text-xs font-medium text-danger hover:underline"
                        onClick={() => void removeEvent(ev)}
                        disabled={busy}
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardBody>
      </Card>

      {/* Edit modal */}
      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
          <Card className="w-full max-w-lg shadow-2xl">
            <CardHeader>
              <h3 className="text-base font-semibold text-text">Edit Event</h3>
            </CardHeader>
            <CardBody className="space-y-4">
              <div>
                <Label>Title</Label>
                <Input
                  className="mt-1.5"
                  value={editing.title}
                  onChange={(e) =>
                    setEditing({ ...editing, title: e.target.value })
                  }
                />
              </div>
              <div>
                <Label>Date</Label>
                <Input
                  type="date"
                  className="mt-1.5"
                  value={editing.date}
                  onChange={(e) =>
                    setEditing({ ...editing, date: e.target.value })
                  }
                />
              </div>
              <div>
                <Label>Description</Label>
                <Textarea
                  rows={4}
                  className="mt-1.5"
                  value={editing.description}
                  onChange={(e) =>
                    setEditing({ ...editing, description: e.target.value })
                  }
                />
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <Button variant="ghost" onClick={() => setEditing(null)}>
                  Cancel
                </Button>
                <Button
                  disabled={busy}
                  onClick={() => void saveEdit()}
                >
                  Save Changes
                </Button>
              </div>
            </CardBody>
          </Card>
        </div>
      )}
    </PageWrapper>
  );
}
