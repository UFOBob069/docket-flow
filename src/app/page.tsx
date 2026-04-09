"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { differenceInCalendarDays, parseISO } from "date-fns";
import { useAuth } from "@/context/AuthContext";
import { getDb } from "@/lib/firebase/client";
import { isFirebaseConfigured } from "@/lib/firebase/config";
import { fetchCasesWithEvents } from "@/lib/firestore/repo";
import type { CalendarEvent, Case } from "@/lib/types";
import { PageSkeleton } from "@/components/PageSkeleton";
import { useHydrated } from "@/hooks/useHydrated";
import {
  Badge,
  Button,
  Card,
  CardBody,
  EmptyState,
  PageHeader,
  PageWrapper,
  Spinner,
} from "@/components/ui";

type Row = { case: Case; event: CalendarEvent };

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function urgency(
  dateStr: string,
  today: string
): "urgent" | "soon" | "quarter" | null {
  const days = differenceInCalendarDays(parseISO(dateStr), parseISO(today));
  if (days < 0 || days > 90) return null;
  if (days <= 7) return "urgent";
  if (days <= 30) return "soon";
  return "quarter";
}

const toneConfig = {
  urgent: {
    title: "Within 7 days",
    badge: "danger" as const,
    dot: "bg-danger",
    border: "border-danger/20",
  },
  soon: {
    title: "8 – 30 days",
    badge: "pink" as const,
    dot: "bg-pink",
    border: "border-pink/20",
  },
  quarter: {
    title: "31 – 90 days",
    badge: "default" as const,
    dot: "bg-text-dim",
    border: "border-border",
  },
};

function Section({
  rows,
  tone,
}: {
  rows: Row[];
  tone: "urgent" | "soon" | "quarter";
}) {
  if (!rows.length) return null;
  const cfg = toneConfig[tone];
  return (
    <Card className={cfg.border}>
      <CardBody>
        <div className="mb-4 flex items-center gap-2">
          <span className={`h-2 w-2 rounded-full ${cfg.dot}`} />
          <Badge variant={cfg.badge}>{cfg.title}</Badge>
          <span className="text-xs text-text-dim">{rows.length} deadline{rows.length !== 1 ? "s" : ""}</span>
        </div>
        <ul className="space-y-1">
          {rows.map(({ case: c, event: e }) => (
            <li key={`${c.id}-${e.id}`}>
              <Link
                href={`/cases/${c.id}`}
                className="group flex items-center justify-between rounded-lg px-3 py-2.5 transition-colors hover:bg-surface-alt"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-text group-hover:text-primary">
                    {c.name}
                  </p>
                  <p className="truncate text-xs text-text-muted">{e.title}</p>
                </div>
                <span className="ml-4 shrink-0 text-xs font-medium tabular-nums text-text-muted">
                  {e.date}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </CardBody>
    </Card>
  );
}

export default function DashboardPage() {
  const router = useRouter();
  const hydrated = useHydrated();
  const { user, loading, idToken, firebaseReady } = useAuth();
  const [rows, setRows] = useState<Row[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    if (!firebaseReady || loading) return;
    if (!user) {
      router.replace("/login");
      return;
    }
    let cancelled = false;
    (async () => {
      setRefreshing(true);
      setLoadError(null);
      try {
        const db = getDb();
        const bundled = await fetchCasesWithEvents(db);
        const flat: Row[] = [];
        const t = todayIso();
        for (const { case: c, events } of bundled) {
          if (c.status !== "active") continue;
          for (const e of events) {
            if (urgency(e.date, t)) flat.push({ case: c, event: e });
          }
        }
        flat.sort((a, b) => a.event.date.localeCompare(b.event.date));
        if (!cancelled) setRows(flat);
      } catch (e) {
        if (!cancelled) {
          setLoadError(e instanceof Error ? e.message : "Failed to load dashboard");
        }
      } finally {
        if (!cancelled) setRefreshing(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user, loading, firebaseReady, router, idToken]);

  const today = todayIso();
  const grouped = useMemo(() => {
    const urgent: Row[] = [];
    const soon: Row[] = [];
    const quarter: Row[] = [];
    for (const r of rows) {
      const u = urgency(r.event.date, today);
      if (u === "urgent") urgent.push(r);
      else if (u === "soon") soon.push(r);
      else if (u === "quarter") quarter.push(r);
    }
    return { urgent, soon, quarter };
  }, [rows, today]);

  if (!hydrated) return <PageSkeleton />;

  if (!isFirebaseConfigured()) {
    return (
      <PageWrapper>
        <h1 className="text-3xl font-semibold">DocketFlow</h1>
        <p className="mt-3 text-text-muted">
          Add Firebase keys to <code className="rounded bg-surface-alt px-1.5 py-0.5 text-sm font-mono text-primary">.env.local</code> to
          run the app. See <code className="rounded bg-surface-alt px-1.5 py-0.5 text-sm font-mono text-primary">.env.example</code> for all variables.
        </p>
      </PageWrapper>
    );
  }

  if (!user && !loading) return null;

  const totalDeadlines = rows.length;

  return (
    <PageWrapper>
      <PageHeader
        title="Upcoming Deadlines"
        subtitle={`Next 90 days · ${totalDeadlines} active deadline${totalDeadlines !== 1 ? "s" : ""}`}
        actions={
          <Link href="/cases/new">
            <Button variant="pink" size="lg">+ New Case</Button>
          </Link>
        }
      />

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

      <div className="mt-8 grid gap-6 lg:grid-cols-3">
        <Section rows={grouped.urgent} tone="urgent" />
        <Section rows={grouped.soon} tone="soon" />
        <Section rows={grouped.quarter} tone="quarter" />
      </div>

      {!refreshing && rows.length === 0 && !loadError && (
        <div className="mt-10">
          <EmptyState
            title="No upcoming deadlines"
            description="Create a case to extract and calendar deadlines from your scheduling orders."
            action={
              <Link href="/cases/new">
                <Button>Create a case</Button>
              </Link>
            }
          />
        </div>
      )}

      <div className="mt-12 border-t border-border pt-8">
        <h2 className="text-lg font-semibold text-text">Quick Links</h2>
        <div className="mt-4 flex flex-wrap gap-3">
          <Link href="/cases">
            <Button variant="secondary" size="sm">All Cases</Button>
          </Link>
          <Link href="/contacts">
            <Button variant="secondary" size="sm">Contacts</Button>
          </Link>
        </div>
      </div>
    </PageWrapper>
  );
}
