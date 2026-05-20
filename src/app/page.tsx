"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { addDays, differenceInCalendarDays, parseISO, format, formatDistanceToNow } from "date-fns";
import { useAuth } from "@/context/AuthContext";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { getBrowserSupabase } from "@/lib/supabase/singleton";
import {
  fetchCasesWithEvents,
  saveEvent,
  subscribeActivity,
  subscribeCaseEventsFirm,
  subscribeContacts,
} from "@/lib/supabase/repo";
import { caseMatchesAssignedRole } from "@/lib/case-assigned-filter";
import { EVENT_KIND_FILTER_OPTIONS } from "@/lib/one-off-events";
import type { ActivityEntry, CalendarEvent, Case, Contact, EventKind } from "@/lib/types";
import { deadlineInclusiveEndDate } from "@/lib/event-date-range";
import { AddCalendarEventModal } from "@/components/AddCalendarEventModal";
import { FilterMultiSelect } from "@/components/FilterMultiSelect";
import { PageSkeleton } from "@/components/PageSkeleton";
import { useHydrated } from "@/hooks/useHydrated";
import {
  Badge,
  Button,
  Card,
  CardBody,
  EmptyState,
  Input,
  Label,
  PageWrapper,
  Spinner,
} from "@/components/ui";

type Row = { case: Case; event: CalendarEvent };

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

const DEFAULT_DASHBOARD_SPAN_DAYS = 90;

function defaultDashboardEnd(startYmd: string): string {
  return format(addDays(parseISO(startYmd), DEFAULT_DASHBOARD_SPAN_DAYS), "yyyy-MM-dd");
}

function formatRangePill(start: string, end: string): string {
  return `${format(parseISO(start), "MMM d")} - ${format(parseISO(end), "MMM d")}`;
}

type Urgency = "overdue" | "today" | "week" | "fortnight" | "quarter";

function classify(dateStr: string, today: string): Urgency | null {
  const days = differenceInCalendarDays(parseISO(dateStr), parseISO(today));
  if (days < 0) return "overdue";
  if (days === 0) return "today";
  if (days <= 7) return "week";
  if (days <= 14) return "fortnight";
  if (days <= 90) return "quarter";
  return null;
}

/** Urgency bucket using multi-day deadline end for overdue / “today” when the span covers today. */
function dashboardUrgency(e: CalendarEvent, today: string): Urgency | null {
  if (e.startDateTime) return classify(e.date, today);
  const last = deadlineInclusiveEndDate(e);
  if (last < today) return "overdue";
  if (e.date <= today && last >= today) return "today";
  return classify(e.date, today);
}

const sectionConfig: Record<Urgency, { title: string; dot: string; badgeVariant: "danger" | "pink" | "warning" | "primary" | "default"; border: string }> = {
  overdue:   { title: "Overdue",         dot: "bg-danger",      badgeVariant: "danger",  border: "border-danger/30 bg-danger/[0.03]" },
  today:     { title: "Today",           dot: "bg-pink",        badgeVariant: "pink",    border: "border-pink/30" },
  week:      { title: "This Week",       dot: "bg-warning",     badgeVariant: "warning", border: "border-warning/30" },
  fortnight: { title: "Next 2 Weeks",    dot: "bg-primary",     badgeVariant: "primary", border: "border-primary/20" },
  quarter:   { title: "Coming Up",       dot: "bg-text-dim",    badgeVariant: "default", border: "border-border" },
};

function DeadlineSection({
  rows,
  urgency,
  contactById,
  onMarkComplete,
  completingEventId,
}: {
  rows: Row[];
  urgency: Urgency;
  contactById: Map<string, Contact>;
  onMarkComplete?: (row: Row) => void;
  completingEventId?: string | null;
}) {
  if (!rows.length) return null;
  const cfg = sectionConfig[urgency];
  return (
    <Card className={cfg.border}>
      <CardBody>
        <div className="mb-3 flex items-center gap-2">
          <span className={`h-2.5 w-2.5 rounded-full ${cfg.dot} ${urgency === "overdue" ? "animate-pulse" : ""}`} />
          <span className="text-sm font-semibold text-text">{cfg.title}</span>
          <Badge variant={cfg.badgeVariant}>{rows.length}</Badge>
        </div>
        <ul className="space-y-0.5">
          {rows.map(({ case: c, event: e }) => {
            const last = deadlineInclusiveEndDate(e);
            const days = differenceInCalendarDays(parseISO(last), parseISO(todayIso()));
            const label = days === 0 ? "Today" : days === 1 ? "Tomorrow" : days < 0 ? `${Math.abs(days)}d overdue` : `${days}d`;
            const assign = c.assignedContactIds;
            const att = assign[0] ? contactById.get(assign[0]) : undefined;
            const par = assign[1] ? contactById.get(assign[1]) : undefined;
            const completing = completingEventId === e.id;
            return (
              <li
                key={`${c.id}-${e.id}`}
                className="flex items-center gap-2 rounded-lg px-3 py-2.5 transition-colors hover:bg-surface-alt"
              >
                <Link href={`/cases/${c.id}`} className="group min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-text group-hover:text-primary">
                        {e.title}
                      </p>
                      <p className="truncate text-xs text-text-muted">{c.name} · {c.clientName}</p>
                      <p className="truncate text-xs text-text-muted">
                        {att?.name ?? "—"}
                        <span className="text-text-dim"> · </span>
                        {par?.name ?? "—"}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <span
                        className={`text-xs font-semibold tabular-nums ${days < 0 ? "text-danger" : days <= 7 ? "text-warning" : "text-text-muted"}`}
                      >
                        {label}
                      </span>
                      <span className="text-xs tabular-nums text-text-dim">
                        {e.deadlineEndDate && e.deadlineEndDate > e.date && !e.startDateTime
                          ? `${format(parseISO(e.date), "MMM d")}–${format(parseISO(e.deadlineEndDate), "MMM d")}`
                          : format(parseISO(e.date), "MMM d")}
                      </span>
                    </div>
                  </div>
                </Link>
                {onMarkComplete && (
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    className="shrink-0"
                    disabled={Boolean(completingEventId)}
                    onClick={() => onMarkComplete({ case: c, event: e })}
                  >
                    {completing ? "…" : "Complete"}
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      </CardBody>
    </Card>
  );
}

const ACTION_LABELS: Record<string, string> = {
  case_created: "created case",
  case_archived: "archived case",
  case_activated: "reactivated case",
  case_deleted: "deleted case",
  event_created: "created events",
  event_edited: "edited event",
  event_deleted: "deleted event",
  events_bulk_deleted: "bulk deleted events",
  events_bulk_rescheduled: "bulk rescheduled events",
  contacts_reassigned: "reassigned contacts",
};

function ActivityFeed({ entries }: { entries: ActivityEntry[] }) {
  if (!entries.length) return null;
  return (
    <Card>
      <CardBody>
        <h3 className="mb-3 text-sm font-semibold text-text">Recent Activity</h3>
        <ul className="space-y-2.5">
          {entries.map((a) => (
            <li key={a.id} className="flex items-start gap-3">
              <div className="mt-1 h-2 w-2 shrink-0 rounded-full bg-primary/40" />
              <div className="min-w-0 flex-1">
                <p className="text-sm text-text">
                  <span className="font-medium">{a.userEmail.split("@")[0]}</span>
                  {" "}{ACTION_LABELS[a.action] ?? a.action}
                  {a.caseName && (
                    <>
                      {" "}
                      {a.caseId ? (
                        <Link href={`/cases/${a.caseId}`} className="font-medium text-primary hover:underline">{a.caseName}</Link>
                      ) : (
                        <span className="font-medium">{a.caseName}</span>
                      )}
                    </>
                  )}
                </p>
                {a.description && <p className="text-xs text-text-muted">{a.description}</p>}
                <p className="text-xs text-text-dim">
                  {formatDistanceToNow(a.createdAt, { addSuffix: true })}
                </p>
              </div>
            </li>
          ))}
        </ul>
      </CardBody>
    </Card>
  );
}

function StatCard({ label, value, accent }: { label: string; value: number; accent?: string }) {
  return (
    <Card>
      <CardBody className="!py-4 !px-5">
        <p className="text-xs font-medium uppercase tracking-wider text-text-dim">{label}</p>
        <p className={`mt-1 text-2xl font-bold tabular-nums ${accent ?? "text-text"}`}>{value}</p>
      </CardBody>
    </Card>
  );
}

export default function DashboardPage() {
  const router = useRouter();
  const hydrated = useHydrated();
  const { user, loading, idToken, supabaseReady } = useAuth();
  const [rows, setRows] = useState<Row[]>([]);
  const [totalDeadlineCount, setTotalDeadlineCount] = useState(0);
  const [activity, setActivity] = useState<ActivityEntry[]>([]);
  const [caseCount, setCaseCount] = useState(0);
  const [activeCasesForPicker, setActiveCasesForPicker] = useState<Case[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [showAddEvent, setShowAddEvent] = useState(false);
  const [search, setSearch] = useState("");
  const [attorneyFilterIds, setAttorneyFilterIds] = useState<string[]>([]);
  const [paralegalFilterIds, setParalegalFilterIds] = useState<string[]>([]);
  const [eventKindFilters, setEventKindFilters] = useState<EventKind[]>([]);
  const [showFiltersDrawer, setShowFiltersDrawer] = useState(false);
  const [showDateModal, setShowDateModal] = useState(false);
  const [timelineStart, setTimelineStart] = useState(() => todayIso());
  const [timelineEnd, setTimelineEnd] = useState(() => defaultDashboardEnd(todayIso()));
  const [completingEventId, setCompletingEventId] = useState<string | null>(null);
  const [rowActionError, setRowActionError] = useState<string | null>(null);

  const loadDashboard = useCallback(async () => {
    if (!user || !supabaseReady) return;
    setRefreshing(true);
    setLoadError(null);
    try {
      const supabase = getBrowserSupabase();
      const bundled = await fetchCasesWithEvents(supabase, user.id);
      const flat: Row[] = [];
      const activeList: Case[] = [];
      const t = todayIso();
      let activeCases = 0;
      let totalDeadlines = 0;
      for (const { case: c, events } of bundled) {
        if (c.status !== "active") continue;
        activeCases++;
        activeList.push(c);
        for (const e of events) {
          if (e.completed) continue;
          totalDeadlines++;
          if (dashboardUrgency(e, t)) flat.push({ case: c, event: e });
        }
      }
      flat.sort((a, b) => a.event.date.localeCompare(b.event.date));
      activeList.sort((a, b) => a.name.localeCompare(b.name));
      setRows(flat);
      setTotalDeadlineCount(totalDeadlines);
      setCaseCount(activeCases);
      setActiveCasesForPicker(activeList);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Failed to load dashboard");
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
    void loadDashboard();
  }, [user, loading, supabaseReady, router, loadDashboard]);

  useEffect(() => {
    if (!supabaseReady || loading || !user) return;
    const supabase = getBrowserSupabase();
    return subscribeContacts(supabase, user.id, setContacts);
  }, [user, loading, supabaseReady]);

  useEffect(() => {
    if (!supabaseReady || loading || !user) return;
    const supabase = getBrowserSupabase();
    return subscribeCaseEventsFirm(supabase, user.id, () => {
      void loadDashboard();
    });
  }, [user, loading, supabaseReady, loadDashboard]);

  useEffect(() => {
    if (!supabaseReady || loading || !user) return;
    const onVisible = () => {
      if (document.visibilityState === "visible") void loadDashboard();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [supabaseReady, loading, user, loadDashboard]);

  useEffect(() => {
    if (!supabaseReady || loading || !user) return;
    const supabase = getBrowserSupabase();
    return subscribeActivity(supabase, user.id, 20, setActivity);
  }, [user, loading, supabaseReady]);

  const today = todayIso();
  const contactById = useMemo(() => {
    const m = new Map<string, Contact>();
    for (const c of contacts) m.set(c.id, c);
    return m;
  }, [contacts]);

  const attorneys = useMemo(() => contacts.filter((c) => c.role === "attorney"), [contacts]);
  const paralegals = useMemo(() => contacts.filter((c) => c.role === "paralegal"), [contacts]);

  const eventKindCheckboxOptions = useMemo(
    () =>
      EVENT_KIND_FILTER_OPTIONS.filter((o) => o.value !== "").map((o) => ({
        id: o.value,
        label: o.label,
      })),
    []
  );

  const attorneyOptions = useMemo(
    () => attorneys.map((c) => ({ id: c.id, label: c.name })),
    [attorneys]
  );
  const paralegalOptions = useMemo(
    () => paralegals.map((c) => ({ id: c.id, label: c.name })),
    [paralegals]
  );

  const markEventComplete = useCallback(
    async ({ case: c, event: e }: Row) => {
      if (!user || completingEventId) return;
      setRowActionError(null);
      setCompletingEventId(e.id);
      try {
        const supabase = getBrowserSupabase();
        await saveEvent(supabase, c.id, { ...e, completed: true, updatedAt: Date.now() });
        setRows((prev) => prev.filter((r) => !(r.case.id === c.id && r.event.id === e.id)));
        setTotalDeadlineCount((n) => Math.max(0, n - 1));
      } catch (err) {
        setRowActionError(err instanceof Error ? err.message : "Could not mark complete");
      } finally {
        setCompletingEventId(null);
      }
    },
    [user, completingEventId]
  );

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter(({ case: c, event: e }) => {
      if (!caseMatchesAssignedRole(c, attorneyFilterIds, "attorney", contactById)) return false;
      if (!caseMatchesAssignedRole(c, paralegalFilterIds, "paralegal", contactById)) return false;
      if (
        eventKindFilters.length &&
        !eventKindFilters.includes((e.eventKind ?? "other_event") as EventKind)
      ) {
        return false;
      }
      const last = deadlineInclusiveEndDate(e);
      const isOverdue = last < today;
      const overlapsTimeline = e.date <= timelineEnd && last >= timelineStart;
      if (!isOverdue && !overlapsTimeline) return false;
      if (!q) return true;
      const hay = [e.title, e.description, c.name, c.clientName, e.deponentOrSubject ?? ""]
        .join("\n")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [
    rows,
    search,
    attorneyFilterIds,
    paralegalFilterIds,
    eventKindFilters,
    timelineStart,
    timelineEnd,
    today,
    contactById,
  ]);

  const grouped = useMemo(() => {
    const buckets: Record<Urgency, Row[]> = { overdue: [], today: [], week: [], fortnight: [], quarter: [] };
    for (const r of filteredRows) {
      const u = dashboardUrgency(r.event, today);
      if (u) buckets[u].push(r);
    }
    return buckets;
  }, [filteredRows, today]);

  const hasCustomDateRange =
    timelineStart !== todayIso() || timelineEnd !== defaultDashboardEnd(todayIso());

  const activeFilterCount =
    (attorneyFilterIds.length ? 1 : 0) +
    (paralegalFilterIds.length ? 1 : 0) +
    (eventKindFilters.length ? 1 : 0) +
    (hasCustomDateRange ? 1 : 0);

  function resetTimelineToDefault() {
    const s = todayIso();
    setTimelineStart(s);
    setTimelineEnd(defaultDashboardEnd(s));
  }

  function clearAllFilters() {
    setAttorneyFilterIds([]);
    setParalegalFilterIds([]);
    setEventKindFilters([]);
    resetTimelineToDefault();
  }

  if (!hydrated) return <PageSkeleton />;

  if (!isSupabaseConfigured()) {
    return (
      <PageWrapper>
        <h1 className="text-3xl font-semibold">DocketFlow</h1>
        <p className="mt-3 text-text-muted">
          Add <code className="rounded bg-surface-alt px-1.5 py-0.5 text-sm font-mono text-primary">NEXT_PUBLIC_SUPABASE_URL</code> and{" "}
          <code className="rounded bg-surface-alt px-1.5 py-0.5 text-sm font-mono text-primary">NEXT_PUBLIC_SUPABASE_ANON_KEY</code> to{" "}
          <code className="rounded bg-surface-alt px-1.5 py-0.5 text-sm font-mono text-primary">.env.local</code> to run the app.
        </p>
      </PageWrapper>
    );
  }

  if (!user && !loading) return null;

  const overdueCount = grouped.overdue.length;
  const thisWeekCount = grouped.today.length + grouped.week.length;

  return (
    <PageWrapper>
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-text lg:text-3xl">Dashboard</h1>
          <p className="mt-1 text-sm text-text-muted">
            {format(new Date(), "EEEE, MMMM d, yyyy")}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {activeCasesForPicker.length > 0 && (
            <Button
              variant="secondary"
              size="lg"
              onClick={() => setShowAddEvent(true)}
              disabled={!idToken}
            >
              Add calendar event
            </Button>
          )}
          <Link href="/cases/new">
            <Button variant="pink" size="lg">+ New Case</Button>
          </Link>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Input
          className="min-w-72 flex-1"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search title, case, client..."
        />
        <button
          type="button"
          onClick={() => setShowDateModal(true)}
          className="rounded-xl border border-border bg-white px-3 py-2 text-sm font-medium shadow-sm transition hover:border-primary/40"
        >
          {formatRangePill(timelineStart, timelineEnd)}
        </button>
        <Button variant="secondary" onClick={() => setShowFiltersDrawer(true)}>
          Filters{activeFilterCount ? ` (${activeFilterCount})` : ""}
        </Button>
      </div>

      {Boolean(
        attorneyFilterIds.length ||
          paralegalFilterIds.length ||
          eventKindFilters.length ||
          hasCustomDateRange
      ) && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {attorneyFilterIds.map((id) => (
            <button
              key={`att-${id}`}
              type="button"
              onClick={() => setAttorneyFilterIds((prev) => prev.filter((x) => x !== id))}
              className="rounded-full bg-surface-alt px-2.5 py-1 text-xs text-text"
            >
              {(contactById.get(id)?.name ?? id)} ×
            </button>
          ))}
          {paralegalFilterIds.map((id) => (
            <button
              key={`par-${id}`}
              type="button"
              onClick={() => setParalegalFilterIds((prev) => prev.filter((x) => x !== id))}
              className="rounded-full bg-surface-alt px-2.5 py-1 text-xs text-text"
            >
              {(contactById.get(id)?.name ?? id)} ×
            </button>
          ))}
          {eventKindFilters.map((kind) => (
            <button
              key={`kind-${kind}`}
              type="button"
              onClick={() => setEventKindFilters((prev) => prev.filter((x) => x !== kind))}
              className="rounded-full bg-surface-alt px-2.5 py-1 text-xs text-text"
            >
              {(eventKindCheckboxOptions.find((o) => o.id === kind)?.label ?? kind)} ×
            </button>
          ))}
          {hasCustomDateRange && (
            <button
              type="button"
              onClick={resetTimelineToDefault}
              className="rounded-full bg-surface-alt px-2.5 py-1 text-xs text-text"
            >
              {formatRangePill(timelineStart, timelineEnd)} ×
            </button>
          )}
          <button
            type="button"
            onClick={clearAllFilters}
            className="text-xs font-medium text-primary hover:underline"
          >
            Clear all
          </button>
        </div>
      )}

      {/* Stats */}
      <div className="mt-8 grid grid-cols-2 gap-4 lg:grid-cols-5">
        <StatCard label="Active Cases" value={caseCount} />
        <StatCard label="Deadlines (Next 90d)" value={rows.length} />
        <StatCard label="Deadlines (Total)" value={totalDeadlineCount} />
        <StatCard label="Overdue" value={overdueCount} accent={overdueCount > 0 ? "text-danger" : undefined} />
        <StatCard label="This Week" value={thisWeekCount} accent={thisWeekCount > 0 ? "text-warning" : undefined} />
      </div>

      {loadError && (
        <div className="mt-6 rounded-lg border border-danger/20 bg-danger-light px-4 py-3" role="alert">
          <p className="text-sm text-danger">{loadError}</p>
        </div>
      )}

      {rowActionError && (
        <div className="mt-6 rounded-lg border border-danger/20 bg-danger-light px-4 py-3" role="alert">
          <p className="text-sm text-danger">{rowActionError}</p>
        </div>
      )}

      {refreshing && !loadError && (
        <div className="mt-8 flex items-center gap-3">
          <Spinner className="h-4 w-4" />
          <p className="text-sm text-text-muted">Loading deadlines…</p>
        </div>
      )}

      {/* Overdue banner */}
      {overdueCount > 0 && (
        <div className="mt-6 rounded-xl border border-danger/30 bg-danger/5 px-5 py-4">
          <div className="flex items-center gap-2">
            <svg className="h-5 w-5 text-danger" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
            </svg>
            <span className="text-sm font-semibold text-danger">
              {overdueCount} overdue deadline{overdueCount !== 1 ? "s" : ""} need attention
            </span>
          </div>
          <p className="mt-2 text-xs text-text-secondary">
            Use <span className="font-medium text-text">Complete</span> on a row to mark it done and remove it from this list (the deadline stays on the case).
          </p>
        </div>
      )}

      {/* Deadline sections + activity sidebar */}
      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_340px]">
        <div className="space-y-4">
          <DeadlineSection
            rows={grouped.overdue}
            urgency="overdue"
            contactById={contactById}
            onMarkComplete={(row) => void markEventComplete(row)}
            completingEventId={completingEventId}
          />
          <DeadlineSection
            rows={grouped.today}
            urgency="today"
            contactById={contactById}
            onMarkComplete={(row) => void markEventComplete(row)}
            completingEventId={completingEventId}
          />
          <DeadlineSection
            rows={grouped.week}
            urgency="week"
            contactById={contactById}
            onMarkComplete={(row) => void markEventComplete(row)}
            completingEventId={completingEventId}
          />
          <DeadlineSection
            rows={grouped.fortnight}
            urgency="fortnight"
            contactById={contactById}
            onMarkComplete={(row) => void markEventComplete(row)}
            completingEventId={completingEventId}
          />
          <DeadlineSection
            rows={grouped.quarter}
            urgency="quarter"
            contactById={contactById}
            onMarkComplete={(row) => void markEventComplete(row)}
            completingEventId={completingEventId}
          />

          {!refreshing && filteredRows.length === 0 && !loadError && (
            <EmptyState
              title="No upcoming deadlines"
              description="Create a case to extract and calendar deadlines from your scheduling orders."
              action={
                <Link href="/cases/new">
                  <Button>Create a case</Button>
                </Link>
              }
            />
          )}
        </div>

        {/* Activity sidebar */}
        <div className="space-y-4">
          <ActivityFeed entries={activity} />
        </div>
      </div>

      {showDateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <button
            type="button"
            className="absolute inset-0 bg-black/25"
            onClick={() => setShowDateModal(false)}
            aria-label="Close date picker"
          />
          <Card className="relative z-10 w-[min(92vw,420px)] rounded-2xl shadow-2xl">
            <CardBody className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-base font-semibold text-text">Date range</h3>
                <button
                  type="button"
                  className="text-xs font-medium text-primary hover:underline"
                  onClick={resetTimelineToDefault}
                >
                  Reset
                </button>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>From</Label>
                  <Input
                    type="date"
                    className="mt-1.5"
                    value={timelineStart}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (!v) return;
                      setTimelineStart(v);
                      setTimelineEnd((end) => (end < v ? v : end));
                    }}
                  />
                </div>
                <div>
                  <Label>To</Label>
                  <Input
                    type="date"
                    className="mt-1.5"
                    value={timelineEnd}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (!v) return;
                      setTimelineEnd(v < timelineStart ? timelineStart : v);
                    }}
                  />
                </div>
              </div>
              <div className="flex justify-end">
                <Button type="button" onClick={() => setShowDateModal(false)}>
                  Apply
                </Button>
              </div>
            </CardBody>
          </Card>
        </div>
      )}

      <div
        className={`fixed inset-0 z-40 transition ${
          showFiltersDrawer ? "pointer-events-auto" : "pointer-events-none"
        }`}
      >
        <button
          type="button"
          className={`absolute inset-0 bg-black/20 transition-opacity ${
            showFiltersDrawer ? "opacity-100" : "opacity-0"
          }`}
          onClick={() => setShowFiltersDrawer(false)}
          aria-label="Close filters"
        />
        <aside
          className={`absolute right-0 top-0 h-full w-[min(92vw,400px)] border-l border-border bg-white p-4 shadow-2xl transition-transform duration-300 ${
            showFiltersDrawer ? "translate-x-0" : "translate-x-full"
          }`}
        >
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-lg font-semibold text-text">Filters</h3>
            <button
              type="button"
              className="text-sm font-medium text-primary hover:underline"
              onClick={clearAllFilters}
            >
              Clear all
            </button>
          </div>
          <div className="space-y-4">
            <FilterMultiSelect
              label="Attorneys"
              options={attorneyOptions}
              selectedIds={attorneyFilterIds}
              onChange={setAttorneyFilterIds}
              placeholder="Select attorneys"
            />
            <FilterMultiSelect
              label="Paralegals"
              options={paralegalOptions}
              selectedIds={paralegalFilterIds}
              onChange={setParalegalFilterIds}
              placeholder="Select paralegals"
            />
            <FilterMultiSelect
              label="Event types"
              options={eventKindCheckboxOptions}
              selectedIds={eventKindFilters}
              onChange={(ids) => setEventKindFilters(ids as EventKind[])}
              placeholder="Select event types"
            />
            <div>
              <Label>Date range</Label>
              <button
                type="button"
                onClick={() => setShowDateModal(true)}
                className="mt-1.5 w-full rounded-xl border border-border bg-white px-3 py-2 text-left text-sm shadow-sm transition hover:border-primary/40"
              >
                {formatRangePill(timelineStart, timelineEnd)}
              </button>
            </div>
            <div className="pt-2">
              <Button type="button" className="w-full" onClick={() => setShowFiltersDrawer(false)}>
                Done
              </Button>
            </div>
          </div>
        </aside>
      </div>

      {user && (
        <AddCalendarEventModal
          open={showAddEvent}
          onClose={() => setShowAddEvent(false)}
          lockedCase={null}
          casePickerOptions={activeCasesForPicker}
          contacts={contacts}
          idToken={idToken}
          user={{ id: user.id, email: user.email }}
          onSaved={() => void loadDashboard()}
        />
      )}
    </PageWrapper>
  );
}
