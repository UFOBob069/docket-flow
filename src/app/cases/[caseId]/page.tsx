"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { getDb } from "@/lib/firebase/client";
import { isFirebaseConfigured } from "@/lib/firebase/config";
import {
  bulkDeleteEvents,
  bulkRescheduleEvents,
  deleteCaseCascade,
  deleteEvent,
  logActivity,
  saveEvent,
  subscribeCase,
  subscribeContacts,
  subscribeEvents,
  updateCase,
} from "@/lib/firestore/repo";
import type { CalendarEvent, Case, CaseStatus, Contact, EventCategory } from "@/lib/types";
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
  const { user, loading, idToken, firebaseReady } = useAuth();
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

  useEffect(() => {
    if (!firebaseReady || loading || !user || !caseId) return;
    const db = getDb();
    const u1 = subscribeCase(db, caseId, setC);
    const u2 = subscribeEvents(db, caseId, setEvents);
    const u3 = subscribeContacts(db, setContacts);
    return () => { u1(); u2(); u3(); };
  }, [user, loading, firebaseReady, caseId]);

  useEffect(() => {
    if (!loading && firebaseReady && !user) router.replace("/login");
  }, [user, loading, firebaseReady, router]);

  function flash(message: string) {
    setSuccessMsg(message);
    setTimeout(() => setSuccessMsg(null), 3000);
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
    const db = getDb();
    await updateCase(db, caseId, { status });
    await logActivity(db, {
      caseId, caseName: c.name,
      action: status === "archived" ? "case_archived" : "case_activated",
      description: `Set status to ${status}`,
      userEmail: user.email ?? "",
    });
  }

  async function removeEvent(ev: CalendarEvent) {
    if (!caseId || !c || !user) return;
    setBusy(true); setMsg(null);
    try {
      if (ev.googleEventId) {
        const res = await calendarApi({
          action: "delete",
          googleEventId: ev.googleEventId,
          ...(ev.googleCalendarEventIdsByEmail &&
          Object.keys(ev.googleCalendarEventIdsByEmail).length > 0
            ? { googleCalendarEventIdsByEmail: ev.googleCalendarEventIdsByEmail }
            : {}),
        }, idToken);
        if (!res.ok) { const j = (await res.json()) as { error?: string }; throw new Error(j.error ?? "Calendar delete failed"); }
      }
      const db = getDb();
      await deleteEvent(db, caseId, ev.id);
      await logActivity(db, {
        caseId, caseName: c.name,
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
    if (!confirm("Delete this case and all events from DocketFlow and Google?")) return;
    setBusy(true); setMsg(null);
    try {
      for (const ev of events) {
        if (ev.googleEventId) {
          const res = await calendarApi({
            action: "delete",
            googleEventId: ev.googleEventId,
            ...(ev.googleCalendarEventIdsByEmail &&
            Object.keys(ev.googleCalendarEventIdsByEmail).length > 0
              ? { googleCalendarEventIdsByEmail: ev.googleCalendarEventIdsByEmail }
              : {}),
          }, idToken);
          if (!res.ok) { const j = (await res.json()) as { error?: string }; throw new Error(j.error ?? "Calendar delete failed"); }
        }
      }
      const db = getDb();
      await logActivity(db, {
        caseName: c.name,
        action: "case_deleted",
        description: `Deleted case "${c.name}" with ${events.length} events`,
        userEmail: user.email ?? "",
      });
      await deleteCaseCascade(db, caseId);
      router.push("/cases");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Could not delete case");
    } finally { setBusy(false); }
  }

  async function saveEdit() {
    if (!editing || !caseId || !c || !user) return;
    setBusy(true); setMsg(null);
    try {
      const db = getDb();
      const updated: CalendarEvent = { ...editing, updatedAt: Date.now() };
      await saveEvent(db, caseId, updated);
      if (updated.googleEventId) {
        const res = await calendarApi({
          action: "update",
          googleEventId: updated.googleEventId,
          ...(updated.googleCalendarEventIdsByEmail &&
          Object.keys(updated.googleCalendarEventIdsByEmail).length > 0
            ? { googleCalendarEventIdsByEmail: updated.googleCalendarEventIdsByEmail }
            : {}),
          caseName: c.name,
          title: updated.title,
          date: updated.date,
          description: updated.description,
          reminderMinutes: updated.remindersMinutes,
        }, idToken);
        if (!res.ok) { const j = (await res.json()) as { error?: string }; throw new Error(j.error ?? "Calendar update failed"); }
      }
      await logActivity(db, {
        caseId, caseName: c.name,
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
          await calendarApi({
            action: "delete",
            googleEventId: ev.googleEventId,
            ...(ev.googleCalendarEventIdsByEmail &&
            Object.keys(ev.googleCalendarEventIdsByEmail).length > 0
              ? { googleCalendarEventIdsByEmail: ev.googleCalendarEventIdsByEmail }
              : {}),
          }, idToken);
        }
      }
      const db = getDb();
      await bulkDeleteEvents(db, caseId, [...selected]);
      await logActivity(db, {
        caseId, caseName: c.name,
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
      const db = getDb();
      const selectedEvents = events.filter((e) => selected.has(e.id));
      await bulkRescheduleEvents(db, caseId, [...selected], days);
      for (const ev of selectedEvents) {
        if (!ev.googleEventId) continue;
        const d = new Date(`${ev.date}T12:00:00`);
        d.setDate(d.getDate() + days);
        const newDate = d.toISOString().slice(0, 10);
        const res = await calendarApi({
          action: "update",
          googleEventId: ev.googleEventId,
          ...(ev.googleCalendarEventIdsByEmail &&
          Object.keys(ev.googleCalendarEventIdsByEmail).length > 0
            ? { googleCalendarEventIdsByEmail: ev.googleCalendarEventIdsByEmail }
            : {}),
          caseName: c.name,
          title: ev.title,
          date: newDate,
          description: ev.description,
          reminderMinutes: ev.remindersMinutes,
        }, idToken);
        if (!res.ok) {
          const j = (await res.json()) as { error?: string };
          throw new Error(j.error ?? "Calendar update failed");
        }
      }
      await logActivity(db, {
        caseId, caseName: c.name,
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
      const db = getDb();
      const newContactIds = reassignIds.filter(Boolean);
      await updateCase(db, caseId, { assignedContactIds: newContactIds });
      const attendeeEmails = Array.from(
        new Set(
          newContactIds
            .map((id) => contacts.find((ct) => ct.id === id)?.email)
            .filter((e): e is string => Boolean(e))
        )
      );
      const withGoogle = events.filter(
        (ev) =>
          ev.googleEventId ||
          (ev.googleCalendarEventIdsByEmail &&
            Object.keys(ev.googleCalendarEventIdsByEmail).length > 0)
      );
      if (withGoogle.length > 0 && attendeeEmails.length > 0) {
        const res = await calendarApi(
          {
            action: "reconcile_team",
            caseName: c.name,
            attendeeEmails,
            events: withGoogle.map((ev) => ({
              title: ev.title,
              date: ev.date,
              description: ev.description,
              reminderMinutes: ev.remindersMinutes,
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
          await saveEvent(db, caseId, {
            ...ev,
            googleEventId: r.organizerEventId,
            googleCalendarEventIdsByEmail: r.idsByEmail,
            updatedAt: Date.now(),
          });
        }
      }
      await logActivity(db, {
        caseId, caseName: c.name,
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
  if (!isFirebaseConfigured()) return <PageWrapper><p className="text-text-muted">Configure Firebase.</p></PageWrapper>;
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
          <h1 className="text-2xl font-semibold tracking-tight text-text lg:text-3xl">{c.name}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-text-muted">
            <span>{c.clientName}</span>
            {c.causeNumber && <><span className="text-border-strong">·</span><span>Cause {c.causeNumber}</span></>}
            {c.court && <><span className="text-border-strong">·</span><span>{c.court}</span></>}
            <Badge variant={c.status === "active" ? "success" : "default"}>{c.status}</Badge>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            size="sm"
            disabled={busy || verifyBusy}
            onClick={() => void runCalendarVerify()}
          >
            {verifyBusy ? "Verifying…" : "Verify Google Calendar"}
          </Button>
          <Button variant="secondary" size="sm" disabled={busy}
            onClick={() => void setStatus(c.status === "active" ? "archived" : "active")}>
            Mark {c.status === "active" ? "archived" : "active"}
          </Button>
          <Button variant="danger" size="sm" disabled={busy} onClick={() => void destroyCase()}>
            Delete case
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
                      <Badge variant={catBadge[ev.category]}>{ev.category}</Badge>
                      {ev.googleEventId && <Badge variant="success">Synced</Badge>}
                      {ev.noiseFlag && <Badge variant="warning">{ev.noiseReason ?? "Noise"}</Badge>}
                    </div>
                    <p className="mt-1 text-sm font-medium text-text">{ev.title}</p>
                    {ev.description && <p className="mt-0.5 text-sm text-text-muted line-clamp-2">{ev.description}</p>}
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

      {/* Edit modal */}
      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
          <Card className="w-full max-w-lg shadow-2xl">
            <CardHeader><h3 className="text-base font-semibold text-text">Edit Event</h3></CardHeader>
            <CardBody className="space-y-4">
              <div><Label>Title</Label><Input className="mt-1.5" value={editing.title} onChange={(e) => setEditing({ ...editing, title: e.target.value })} /></div>
              <div><Label>Date</Label><Input type="date" className="mt-1.5" value={editing.date} onChange={(e) => setEditing({ ...editing, date: e.target.value })} /></div>
              <div><Label>Description</Label><Textarea rows={4} className="mt-1.5" value={editing.description} onChange={(e) => setEditing({ ...editing, description: e.target.value })} /></div>
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
