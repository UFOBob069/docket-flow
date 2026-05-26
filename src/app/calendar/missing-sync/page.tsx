"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { format, parseISO } from "date-fns";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { getBrowserSupabase } from "@/lib/supabase/singleton";
import { caseDisplayName } from "@/lib/case-display";
import {
  canAccessCalendarMissingSync,
  createGoogleInvitesForCase,
  listUnsyncedEvents,
  rowKey,
  type GapSyncProgress,
  type UnsyncedEventRow,
} from "@/lib/calendar-gap-sync";
import { fetchCasesWithEvents, subscribeContacts } from "@/lib/supabase/repo";
import type { CalendarEvent, Case, Contact } from "@/lib/types";
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

export default function MissingCalendarSyncPage() {
  const router = useRouter();
  const hydrated = useHydrated();
  const { user, loading, idToken, supabaseReady } = useAuth();
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [rows, setRows] = useState<UnsyncedEventRow[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showBlocked, setShowBlocked] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [syncBusy, setSyncBusy] = useState(false);
  const [syncProgress, setSyncProgress] = useState<GapSyncProgress | null>(null);

  const loadRows = useCallback(async () => {
    if (!user || !supabaseReady) return;
    setRefreshing(true);
    setLoadError(null);
    try {
      const supabase = getBrowserSupabase();
      const bundled = await fetchCasesWithEvents(supabase, user.id);
      setRows(listUnsyncedEvents(bundled, { forwardOnly: true, todayYmd: todayYmd() }));
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
    if (!canAccessCalendarMissingSync(user.email)) {
      router.replace("/");
      return;
    }
    void loadRows();
  }, [user, loading, supabaseReady, router, loadRows]);

  useEffect(() => {
    if (!supabaseReady || loading || !user) return;
    const supabase = getBrowserSupabase();
    return subscribeContacts(supabase, user.id, setContacts);
  }, [user, loading, supabaseReady]);

  const creatable = useMemo(() => rows.filter((r) => r.canCreate), [rows]);
  const blocked = useMemo(() => rows.filter((r) => !r.canCreate), [rows]);

  const visibleRows = useMemo(() => {
    const base = showBlocked ? rows : creatable;
    const q = search.trim().toLowerCase();
    if (!q) return base;
    return base.filter(({ case: c, event: e }) => {
      const hay = [
        caseDisplayName(c),
        c.clientName,
        c.caseNumber ?? "",
        e.title,
        e.date,
      ]
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [rows, creatable, showBlocked, search]);

  const visibleCreatable = useMemo(() => visibleRows.filter((r) => r.canCreate), [visibleRows]);
  const allVisibleSelected =
    visibleCreatable.length > 0 &&
    visibleCreatable.every((r) => selected.has(rowKey(r.case.id, r.event.id)));

  function toggleRow(r: UnsyncedEventRow) {
    if (!r.canCreate) return;
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
        for (const r of visibleCreatable) next.delete(rowKey(r.case.id, r.event.id));
        return next;
      });
    } else {
      setSelected((prev) => {
        const next = new Set(prev);
        for (const r of visibleCreatable) next.add(rowKey(r.case.id, r.event.id));
        return next;
      });
    }
  }

  function flash(message: string) {
    setSuccessMsg(message);
    setTimeout(() => setSuccessMsg(null), 4000);
  }

  async function createSelectedInvites() {
    if (!user || !idToken || selected.size === 0 || syncBusy) return;
    setSyncBusy(true);
    setMsg(null);
    setSyncProgress({ phase: "Starting…", current: 0, total: 1 });
    try {
      const supabase = getBrowserSupabase();
      const byCase = new Map<string, { caseRecord: Case; events: CalendarEvent[] }>();
      for (const r of creatable) {
        const key = rowKey(r.case.id, r.event.id);
        if (!selected.has(key)) continue;
        const bucket = byCase.get(r.case.id) ?? { caseRecord: r.case, events: [] };
        bucket.events.push(r.event);
        byCase.set(r.case.id, bucket);
      }

      let totalLinked = 0;
      const caseEntries = [...byCase.values()];
      for (let i = 0; i < caseEntries.length; i++) {
        const { caseRecord, events } = caseEntries[i]!;
        setSyncProgress({
          phase: `Case ${i + 1} of ${caseEntries.length}: ${caseDisplayName(caseRecord)}`,
          current: i,
          total: caseEntries.length,
        });
        const linked = await createGoogleInvitesForCase(supabase, {
          caseRecord,
          events,
          contacts,
          idToken,
          userId: user.id,
          userEmail: user.email ?? "",
          onProgress: (p) => setSyncProgress(p),
        });
        totalLinked += linked;
      }

      setSelected(new Set());
      await loadRows();
      flash(
        totalLinked > 0
          ? `Created ${totalLinked} Google Calendar invite${totalLinked !== 1 ? "s" : ""}`
          : "Nothing was created — selected rows may already be synced or ineligible."
      );
    } catch (e) {
      let message = e instanceof Error ? e.message : "Could not create invites";
      if (message === "Failed to fetch") {
        message =
          "Network error or timeout. Refresh this page — some invites may have been created anyway.";
      }
      setMsg(message);
      await loadRows();
    } finally {
      setSyncBusy(false);
      setSyncProgress(null);
    }
  }

  if (!hydrated || loading || !supabaseReady) {
    return <PageSkeleton />;
  }

  if (!isSupabaseConfigured()) {
    return (
      <PageWrapper>
        <p className="text-text-muted">Configure Supabase to use missing sync.</p>
      </PageWrapper>
    );
  }

  if (!user) return null;

  if (!canAccessCalendarMissingSync(user.email)) {
    return null;
  }

  return (
    <PageWrapper className="max-w-[1100px]">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-medium uppercase tracking-wider text-text-dim">Calendar</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-text">Missing Google Calendar sync</h1>
          <p className="mt-2 max-w-2xl text-sm text-text-muted">
            Today and upcoming deadlines in DocketFlow with no Google event id. Select rows and create invites for
            anything that should be on the team calendar. Past dates are hidden. Backfills, ICS mirrors, completed,
            and excluded rows appear under blocked items when enabled.
          </p>
        </div>
        <Button variant="secondary" size="sm" disabled={refreshing || syncBusy} onClick={() => void loadRows()}>
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
        <label className="flex cursor-pointer items-center gap-2 text-sm text-text-secondary">
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-border text-primary focus:ring-primary/30"
            checked={showBlocked}
            onChange={(e) => setShowBlocked(e.target.checked)}
          />
          Show blocked ({blocked.length})
        </label>
        <span className="text-sm text-text-muted">
          {creatable.length} can sync · {blocked.length} blocked · {rows.length} total missing ids
        </span>
      </div>

      {selected.size > 0 && (
        <div className="sticky top-16 z-30 mt-4 flex flex-wrap items-center gap-3 rounded-xl border border-primary/20 bg-primary-light px-5 py-3 shadow-sm">
          <span className="text-sm font-semibold text-primary">{selected.size} selected</span>
          <Button size="sm" disabled={syncBusy || !idToken} onClick={() => void createSelectedInvites()}>
            {syncBusy ? "Creating…" : "Create Google invites"}
          </Button>
          <Button variant="ghost" size="sm" disabled={syncBusy} onClick={() => setSelected(new Set())}>
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
            title={showBlocked ? "No blocked rows" : "All caught up"}
            description={
              showBlocked
                ? "Every missing-sync row is eligible to create invites."
                : "No active deadlines are missing Google Calendar linkage."
            }
          />
        </div>
      )}

      {!refreshing && visibleRows.length > 0 && (
        <Card className="mt-6">
          <CardHeader>
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-base font-semibold text-text">
                {showBlocked ? "Missing sync (including blocked)" : "Ready to create invites"}
              </h2>
              {!showBlocked && visibleCreatable.length > 0 && (
                <button
                  type="button"
                  className="text-xs font-medium text-primary hover:underline"
                  onClick={toggleAllVisible}
                >
                  {allVisibleSelected ? "Deselect all" : "Select all"}
                </button>
              )}
            </div>
          </CardHeader>
          <CardBody className="p-0">
            <ul className="divide-y divide-border">
              {visibleRows.map(({ case: c, event: e, canCreate, blockReason }) => {
                const key = rowKey(c.id, e.id);
                const checked = selected.has(key);
                return (
                  <li
                    key={key}
                    className={`flex gap-4 px-5 py-4 ${!canCreate ? "bg-surface-alt/40" : ""}`}
                  >
                    <div className="pt-0.5">
                      <input
                        type="checkbox"
                        className="h-4 w-4 rounded border-border text-primary focus:ring-primary/30 disabled:opacity-40"
                        checked={checked}
                        disabled={!canCreate || syncBusy}
                        onChange={() => toggleRow({ case: c, event: e, canCreate, blockReason })}
                      />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-medium text-text">{e.title}</p>
                        {canCreate ? (
                          <Badge variant="warning">No Google id</Badge>
                        ) : (
                          <Badge variant="default">Blocked</Badge>
                        )}
                        {e.scheduleKind === "meeting" ? (
                          <Badge variant="primary">Meeting</Badge>
                        ) : (
                          <Badge variant="default">Deadline</Badge>
                        )}
                      </div>
                      <p className="mt-1 text-xs text-text-muted">
                        <Link href={`/cases/${c.id}`} className="font-medium text-primary hover:underline">
                          {caseDisplayName(c)}
                        </Link>
                        {c.clientName && c.clientName !== caseDisplayName(c) && (
                          <span> · {c.clientName}</span>
                        )}
                      </p>
                      {blockReason && (
                        <p className="mt-1 text-xs text-text-dim">{blockReason}</p>
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

      {syncBusy && syncProgress && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/45 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-live="polite"
        >
          <div className="w-full max-w-md rounded-2xl border border-border bg-white p-6 shadow-xl">
            <h2 className="text-base font-semibold text-text">Creating Google Calendar invites</h2>
            <p className="mt-2 text-sm text-text-secondary">{syncProgress.phase}</p>
            <div className="mt-4 h-2.5 w-full overflow-hidden rounded-full bg-surface-alt">
              <div
                className="h-full rounded-full bg-primary transition-[width] duration-300 ease-out"
                style={{
                  width: `${
                    syncProgress.total > 0
                      ? Math.min(100, Math.round((syncProgress.current / syncProgress.total) * 100))
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
