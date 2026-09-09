"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { format, parseISO } from "date-fns";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { getBrowserSupabase } from "@/lib/supabase/singleton";
import { canAccessFirmAdminTools } from "@/lib/admin-access";
import { caseDisplayName } from "@/lib/case-display";
import {
  listClosedCaseGoogleInviteRows,
  removeGoogleInvitesForCase,
  rowKey,
  type ClosedInviteRow,
  type GapSyncProgress,
} from "@/lib/calendar-gap-sync";
import { fetchArchivedCasesWithGoogleSyncedEvents } from "@/lib/supabase/repo";
import type { CalendarEvent, Case } from "@/lib/types";
import { PageSkeleton } from "@/components/PageSkeleton";
import { useHydrated } from "@/hooks/useHydrated";
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  Input,
  PageWrapper,
  Spinner,
} from "@/components/ui";

function todayYmd(): string {
  return new Date().toISOString().slice(0, 10);
}

function formatEventDate(ev: CalendarEvent): string {
  if (ev.startDateTime) return ev.date;
  if (ev.deadlineEndDate && ev.deadlineEndDate > ev.date) {
    return `${format(parseISO(ev.date), "MMM d, yyyy")} → ${format(parseISO(ev.deadlineEndDate), "MMM d, yyyy")}`;
  }
  return format(parseISO(ev.date), "MMM d, yyyy");
}

export default function ClosedCaseInvitesPage() {
  const router = useRouter();
  const hydrated = useHydrated();
  const { user, loading, idToken, supabaseReady } = useAuth();
  const [rows, setRows] = useState<ClosedInviteRow[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [msg, setMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<GapSyncProgress | null>(null);

  const loadRows = useCallback(async () => {
    if (!user || !supabaseReady) return;
    setRefreshing(true);
    setLoadError(null);
    try {
      const supabase = getBrowserSupabase();
      const bundled = await fetchArchivedCasesWithGoogleSyncedEvents(supabase);
      setRows(listClosedCaseGoogleInviteRows(bundled));
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Failed to load events");
    } finally {
      setRefreshing(false);
    }
  }, [user, supabaseReady]);

  useEffect(() => {
    if (!supabaseReady || loading) return;
    if (!user) {
      router.replace("/login");
      return;
    }
    if (!canAccessFirmAdminTools(user.email)) {
      router.replace("/");
      return;
    }
    void loadRows();
  }, [user, loading, supabaseReady, router, loadRows]);

  const visibleRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(({ case: c, event: e }) => {
      const hay = [caseDisplayName(c), c.clientName, c.caseNumber ?? "", e.title, e.date]
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [rows, search]);

  const caseCount = useMemo(() => new Set(visibleRows.map((r) => r.case.id)).size, [visibleRows]);

  const allVisibleSelected =
    visibleRows.length > 0 &&
    visibleRows.every((r) => selected.has(rowKey(r.case.id, r.event.id)));

  function toggleRow(r: ClosedInviteRow) {
    const key = rowKey(r.case.id, r.event.id);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function toggleAllVisible() {
    if (allVisibleSelected) {
      setSelected((prev) => {
        const next = new Set(prev);
        for (const r of visibleRows) next.delete(rowKey(r.case.id, r.event.id));
        return next;
      });
    } else {
      setSelected((prev) => {
        const next = new Set(prev);
        for (const r of visibleRows) next.add(rowKey(r.case.id, r.event.id));
        return next;
      });
    }
  }

  function flash(message: string) {
    setSuccessMsg(message);
    setTimeout(() => setSuccessMsg(null), 4000);
  }

  async function removeSelectedInvites() {
    if (!user || !idToken || selected.size === 0 || busy) return;
    if (
      !confirm(
        `Remove ${selected.size} Google Calendar invite${selected.size !== 1 ? "s" : ""} from closed cases?\n\nDocketFlow deadlines stay as history; only Google Calendar copies are removed.`
      )
    ) {
      return;
    }

    setBusy(true);
    setMsg(null);
    setProgress({ phase: "Starting…", current: 0, total: 1 });
    try {
      const supabase = getBrowserSupabase();
      const byCase = new Map<string, { caseRecord: Case; events: CalendarEvent[] }>();
      for (const r of rows) {
        const key = rowKey(r.case.id, r.event.id);
        if (!selected.has(key)) continue;
        const bucket = byCase.get(r.case.id) ?? { caseRecord: r.case, events: [] };
        bucket.events.push(r.event);
        byCase.set(r.case.id, bucket);
      }

      let totalRemoved = 0;
      const caseEntries = [...byCase.values()];
      for (let i = 0; i < caseEntries.length; i++) {
        const { caseRecord, events } = caseEntries[i]!;
        setProgress({
          phase: `Case ${i + 1} of ${caseEntries.length}: ${caseDisplayName(caseRecord)}`,
          current: i,
          total: caseEntries.length,
        });
        const removed = await removeGoogleInvitesForCase(supabase, {
          caseRecord,
          events,
          idToken,
          userId: user.id,
          userEmail: user.email ?? "",
          onProgress: (p) => setProgress(p),
        });
        totalRemoved += removed;
      }

      setSelected(new Set());
      await loadRows();
      flash(
        totalRemoved > 0
          ? `Removed ${totalRemoved} Google Calendar invite${totalRemoved !== 1 ? "s" : ""}`
          : "Nothing was removed — selected rows may already be cleared."
      );
    } catch (e) {
      let message = e instanceof Error ? e.message : "Could not remove invites";
      if (message === "Failed to fetch") {
        message =
          "Network error or timeout. Refresh this page — some invites may have been removed anyway.";
      }
      setMsg(message);
      await loadRows();
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  if (!hydrated || loading || !supabaseReady) {
    return <PageSkeleton />;
  }

  if (!isSupabaseConfigured()) {
    return (
      <PageWrapper>
        <p className="text-text-muted">Configure Supabase to use closed-case invite cleanup.</p>
      </PageWrapper>
    );
  }

  if (!user) return null;

  if (!canAccessFirmAdminTools(user.email)) {
    return null;
  }

  return (
    <PageWrapper className="max-w-[1100px]">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-medium uppercase tracking-wider text-text-dim">Calendar</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-text">
            Closed cases with Google invites
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-text-muted">
            Archived cases that still have DocketFlow-managed Google Calendar invites. Select rows to remove those
            invites from team calendars. Deadlines stay in DocketFlow as history.{" "}
            <Link href="/calendar/missing-sync" className="font-medium text-primary hover:underline">
              Missing sync
            </Link>
          </p>
        </div>
        <Button variant="secondary" size="sm" disabled={refreshing || busy} onClick={() => void loadRows()}>
          Refresh
        </Button>
      </div>

      {successMsg && (
        <div className="mt-4 rounded-lg border border-success/30 bg-success-light px-4 py-3 text-sm text-success">
          {successMsg}
        </div>
      )}
      {msg && (
        <div className="mt-4 rounded-lg border border-danger/20 bg-danger-light px-4 py-3 text-sm text-danger" role="alert">
          {msg}
        </div>
      )}
      {loadError && (
        <div className="mt-4 rounded-lg border border-danger/20 bg-danger-light px-4 py-3 text-sm text-danger" role="alert">
          {loadError}
        </div>
      )}

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <Input
          className="max-w-sm"
          placeholder="Search case, client, title…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <span className="text-sm text-text-muted">
          {visibleRows.length} invite{visibleRows.length !== 1 ? "s" : ""} · {caseCount} closed case
          {caseCount !== 1 ? "s" : ""}
          {search.trim() && rows.length !== visibleRows.length ? ` · ${rows.length} total` : ""}
        </span>
      </div>

      {selected.size > 0 && (
        <div className="sticky top-16 z-30 mt-4 flex flex-wrap items-center gap-3 rounded-xl border border-danger/20 bg-danger-light px-5 py-3 shadow-sm">
          <span className="text-sm font-semibold text-danger">{selected.size} selected</span>
          <Button
            size="sm"
            variant="danger"
            disabled={busy || !idToken}
            onClick={() => void removeSelectedInvites()}
          >
            {busy ? "Removing…" : "Remove Google invites"}
          </Button>
          <Button variant="ghost" size="sm" disabled={busy} onClick={() => setSelected(new Set())}>
            Clear
          </Button>
        </div>
      )}

      {refreshing && !loadError && (
        <div className="mt-8 flex items-center gap-3">
          <Spinner className="h-4 w-4" />
          <p className="text-sm text-text-muted">Loading…</p>
        </div>
      )}

      {!refreshing && visibleRows.length === 0 && !loadError && (
        <div className="mt-8">
          <EmptyState
            title={search.trim() ? "No matches" : "All clear"}
            description={
              search.trim()
                ? "No closed-case Google invites match that search."
                : "No archived cases currently have DocketFlow-managed Google Calendar invites."
            }
          />
        </div>
      )}

      {!refreshing && visibleRows.length > 0 && (
        <Card className="mt-6">
          <CardHeader>
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-base font-semibold text-text">Google invites on closed cases</h2>
              <button
                type="button"
                className="text-xs font-medium text-primary hover:underline"
                onClick={toggleAllVisible}
              >
                {allVisibleSelected ? "Deselect all" : "Select all"}
              </button>
            </div>
          </CardHeader>
          <CardBody className="p-0">
            <ul className="divide-y divide-border">
              {visibleRows.map(({ case: c, event: e }) => {
                const key = rowKey(c.id, e.id);
                const checked = selected.has(key);
                const isPast = (e.deadlineEndDate && e.deadlineEndDate > e.date ? e.deadlineEndDate : e.date) < todayYmd();
                return (
                  <li key={key} className="flex gap-4 px-5 py-4">
                    <div className="pt-0.5">
                      <input
                        type="checkbox"
                        className="h-4 w-4 rounded border-border text-primary focus:ring-primary/30 disabled:opacity-40"
                        checked={checked}
                        disabled={busy}
                        onChange={() => toggleRow({ case: c, event: e })}
                      />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-medium text-text">{e.title}</p>
                        <Badge variant="default">Closed</Badge>
                        <Badge variant="success">Synced</Badge>
                        {e.completed && <Badge variant="default">Completed</Badge>}
                        {isPast && !e.completed && <Badge variant="warning">Past</Badge>}
                        {e.scheduleKind === "meeting" ? (
                          <Badge variant="primary">Meeting</Badge>
                        ) : (
                          <Badge variant="default">Deadline</Badge>
                        )}
                      </div>
                      <p className="mt-1 text-xs text-text-muted">
                        <Link
                          href={`/cases/${c.id}`}
                          prefetch={false}
                          className="font-medium text-primary hover:underline"
                        >
                          {caseDisplayName(c)}
                        </Link>
                        {c.clientName && c.clientName !== caseDisplayName(c) && (
                          <span> · {c.clientName}</span>
                        )}
                      </p>
                      {e.description?.trim() && (
                        <p className="mt-1 line-clamp-2 text-xs text-text-secondary">{e.description.trim()}</p>
                      )}
                    </div>
                    <div className="shrink-0 text-right text-sm tabular-nums text-text-secondary">
                      {formatEventDate(e)}
                    </div>
                  </li>
                );
              })}
            </ul>
          </CardBody>
        </Card>
      )}

      {busy && progress && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/45 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-live="polite"
        >
          <div className="w-full max-w-md rounded-2xl border border-border bg-white p-6 shadow-xl">
            <h2 className="text-base font-semibold text-text">Removing Google Calendar invites</h2>
            <p className="mt-2 text-sm text-text-secondary">{progress.phase}</p>
            <div className="mt-4 h-2.5 w-full overflow-hidden rounded-full bg-surface-alt">
              <div
                className="h-full rounded-full bg-danger transition-[width] duration-300 ease-out"
                style={{
                  width: `${
                    progress.total > 0
                      ? Math.min(100, Math.round((progress.current / progress.total) * 100))
                      : 0
                  }%`,
                }}
              />
            </div>
            <p className="mt-3 text-xs text-text-muted">Keep this page open until finished.</p>
          </div>
        </div>
      )}
    </PageWrapper>
  );
}
