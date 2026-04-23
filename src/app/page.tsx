"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { differenceInCalendarDays, parseISO, format, formatDistanceToNow } from "date-fns";
import { useAuth } from "@/context/AuthContext";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { getBrowserSupabase } from "@/lib/supabase/singleton";
import { fetchCasesWithEvents, subscribeActivity, subscribeContacts } from "@/lib/supabase/repo";
import type { ActivityEntry, CalendarEvent, Case, Contact } from "@/lib/types";
import { AddCalendarEventModal } from "@/components/AddCalendarEventModal";
import { PageSkeleton } from "@/components/PageSkeleton";
import { useHydrated } from "@/hooks/useHydrated";
import {
  Badge,
  Button,
  Card,
  CardBody,
  EmptyState,
  PageWrapper,
  Spinner,
} from "@/components/ui";

type Row = { case: Case; event: CalendarEvent };

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
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

const sectionConfig: Record<Urgency, { title: string; dot: string; badgeVariant: "danger" | "pink" | "warning" | "primary" | "default"; border: string }> = {
  overdue:   { title: "Overdue",         dot: "bg-danger",      badgeVariant: "danger",  border: "border-danger/30 bg-danger/[0.03]" },
  today:     { title: "Today",           dot: "bg-pink",        badgeVariant: "pink",    border: "border-pink/30" },
  week:      { title: "This Week",       dot: "bg-warning",     badgeVariant: "warning", border: "border-warning/30" },
  fortnight: { title: "Next 2 Weeks",    dot: "bg-primary",     badgeVariant: "primary", border: "border-primary/20" },
  quarter:   { title: "Coming Up",       dot: "bg-text-dim",    badgeVariant: "default", border: "border-border" },
};

function DeadlineSection({ rows, urgency }: { rows: Row[]; urgency: Urgency }) {
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
            const days = differenceInCalendarDays(parseISO(e.date), parseISO(todayIso()));
            const label = days === 0 ? "Today" : days === 1 ? "Tomorrow" : days < 0 ? `${Math.abs(days)}d overdue` : `${days}d`;
            return (
              <li key={`${c.id}-${e.id}`}>
                <Link
                  href={`/cases/${c.id}`}
                  className="group flex items-center justify-between rounded-lg px-3 py-2.5 transition-colors hover:bg-surface-alt"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-text group-hover:text-primary">
                      {e.title}
                    </p>
                    <p className="truncate text-xs text-text-muted">{c.name} · {c.clientName}</p>
                  </div>
                  <div className="ml-4 flex shrink-0 items-center gap-2">
                    <span className={`text-xs font-semibold tabular-nums ${days < 0 ? "text-danger" : days <= 7 ? "text-warning" : "text-text-muted"}`}>
                      {label}
                    </span>
                    <span className="text-xs tabular-nums text-text-dim">
                      {format(parseISO(e.date), "MMM d")}
                    </span>
                  </div>
                </Link>
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
  const [activity, setActivity] = useState<ActivityEntry[]>([]);
  const [caseCount, setCaseCount] = useState(0);
  const [activeCasesForPicker, setActiveCasesForPicker] = useState<Case[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [showAddEvent, setShowAddEvent] = useState(false);

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
      for (const { case: c, events } of bundled) {
        if (c.status !== "active") continue;
        activeCases++;
        activeList.push(c);
        for (const e of events) {
          if (e.completed) continue;
          if (classify(e.date, t)) flat.push({ case: c, event: e });
        }
      }
      flat.sort((a, b) => a.event.date.localeCompare(b.event.date));
      activeList.sort((a, b) => a.name.localeCompare(b.name));
      setRows(flat);
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
    return subscribeActivity(supabase, user.id, 20, setActivity);
  }, [user, loading, supabaseReady]);

  const today = todayIso();
  const grouped = useMemo(() => {
    const buckets: Record<Urgency, Row[]> = { overdue: [], today: [], week: [], fortnight: [], quarter: [] };
    for (const r of rows) {
      const u = classify(r.event.date, today);
      if (u) buckets[u].push(r);
    }
    return buckets;
  }, [rows, today]);

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

      {/* Stats */}
      <div className="mt-8 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Active Cases" value={caseCount} />
        <StatCard label="Total Deadlines" value={rows.length} />
        <StatCard label="Overdue" value={overdueCount} accent={overdueCount > 0 ? "text-danger" : undefined} />
        <StatCard label="This Week" value={thisWeekCount} accent={thisWeekCount > 0 ? "text-warning" : undefined} />
      </div>

      {loadError && (
        <div className="mt-6 rounded-lg border border-danger/20 bg-danger-light px-4 py-3" role="alert">
          <p className="text-sm text-danger">{loadError}</p>
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
        </div>
      )}

      {/* Deadline sections + activity sidebar */}
      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_340px]">
        <div className="space-y-4">
          <DeadlineSection rows={grouped.overdue} urgency="overdue" />
          <DeadlineSection rows={grouped.today} urgency="today" />
          <DeadlineSection rows={grouped.week} urgency="week" />
          <DeadlineSection rows={grouped.fortnight} urgency="fortnight" />
          <DeadlineSection rows={grouped.quarter} urgency="quarter" />

          {!refreshing && rows.length === 0 && !loadError && (
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
