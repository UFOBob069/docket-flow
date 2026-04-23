"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { addDays, endOfMonth, format, parseISO, startOfMonth } from "date-fns";
import { useAuth } from "@/context/AuthContext";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { getBrowserSupabase } from "@/lib/supabase/singleton";
import {
  fetchCasesWithEvents,
  fetchEventsInDateRange,
  subscribeContacts,
  type EventWithCaseRow,
} from "@/lib/supabase/repo";
import { isGoogleIcsMirrorEvent } from "@/lib/calendar-event-origin";
import { compareEventsBySchedule } from "@/lib/event-schedule";
import { CALENDAR_TIMEZONE } from "@/lib/event-factory";
import { EVENT_KIND_FILTER_OPTIONS, eventKindDisplayLabel } from "@/lib/one-off-events";
import type { CalendarEvent, Case, Contact, EventCategory, EventKind } from "@/lib/types";
import { AddCalendarEventModal } from "@/components/AddCalendarEventModal";
import { MonthlyEventCalendar } from "@/components/MonthlyEventCalendar";
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
  Select,
  Spinner,
} from "@/components/ui";

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function categoryBadgeVariant(c: EventCategory) {
  if (c === "trial") return "trial";
  if (c === "discovery") return "discovery";
  if (c === "motions") return "motions";
  if (c === "pretrial") return "pretrial";
  if (c === "mediation") return "mediation";
  if (c === "experts") return "experts";
  return "other";
}

function formatWhen(e: CalendarEvent): string {
  if (e.startDateTime) {
    try {
      const d = new Date(e.startDateTime);
      if (!Number.isNaN(d.getTime())) {
        return d.toLocaleString(undefined, {
          weekday: "short",
          month: "short",
          day: "numeric",
          year: "numeric",
          hour: "numeric",
          minute: "2-digit",
          timeZone: CALENDAR_TIMEZONE,
        });
      }
    } catch {
      /* fall through */
    }
  }
  return format(parseISO(e.date), "EEEE, MMM d, yyyy");
}

function eventKindLabel(kind: CalendarEvent["eventKind"]): string | null {
  return eventKindDisplayLabel(kind);
}

const TWO_WEEKS_DAYS = 14;

type CalendarViewMode = "timeline" | "month";

export default function CalendarPage() {
  const router = useRouter();
  const hydrated = useHydrated();
  const { user, loading, supabaseReady, idToken } = useAuth();
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [activeCasesForPicker, setActiveCasesForPicker] = useState<Case[]>([]);
  const [showAddEvent, setShowAddEvent] = useState(false);
  const [rows, setRows] = useState<EventWithCaseRow[]>([]);
  const [weeksEndOffsetDays, setWeeksEndOffsetDays] = useState(TWO_WEEKS_DAYS);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const [search, setSearch] = useState("");
  const [attorneyFilter, setAttorneyFilter] = useState("");
  const [paralegalFilter, setParalegalFilter] = useState("");
  const [eventKindFilter, setEventKindFilter] = useState<EventKind | "">("");
  const [viewMode, setViewMode] = useState<CalendarViewMode>("timeline");
  const [monthCursor, setMonthCursor] = useState(() => format(new Date(), "yyyy-MM"));

  const { rangeStart, rangeEnd } = useMemo(() => {
    if (viewMode === "month") {
      const start = startOfMonth(parseISO(`${monthCursor}-01`));
      const end = endOfMonth(start);
      return { rangeStart: format(start, "yyyy-MM-dd"), rangeEnd: format(end, "yyyy-MM-dd") };
    }
    const rs = todayIso();
    const re = format(addDays(parseISO(rs), weeksEndOffsetDays - 1), "yyyy-MM-dd");
    return { rangeStart: rs, rangeEnd: re };
  }, [viewMode, monthCursor, weeksEndOffsetDays]);

  useEffect(() => {
    if (!supabaseReady || loading || !user) return;
    const supabase = getBrowserSupabase();
    return subscribeContacts(supabase, user.id, setContacts);
  }, [user, loading, supabaseReady]);

  useEffect(() => {
    if (!loading && supabaseReady && !user) router.replace("/login");
  }, [user, loading, supabaseReady, router]);

  useEffect(() => {
    if (!supabaseReady || loading || !user) return;
    let cancelled = false;
    (async () => {
      try {
        const supabase = getBrowserSupabase();
        const bundled = await fetchCasesWithEvents(supabase, user.id);
        const activeList: Case[] = [];
        for (const { case: c } of bundled) {
          if (c.status === "active") activeList.push(c);
        }
        activeList.sort((a, b) => a.name.localeCompare(b.name));
        if (!cancelled) setActiveCasesForPicker(activeList);
      } catch {
        if (!cancelled) setActiveCasesForPicker([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user, loading, supabaseReady]);

  const loadEventsForRange = useCallback(async () => {
    if (!supabaseReady || loading || !user) return;
    setRefreshing(true);
    setLoadError(null);
    try {
      const supabase = getBrowserSupabase();
      const list = await fetchEventsInDateRange(supabase, user.id, rangeStart, rangeEnd);
      setRows(list);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Failed to load events");
    } finally {
      setRefreshing(false);
    }
  }, [user, loading, supabaseReady, rangeStart, rangeEnd]);

  useEffect(() => {
    void loadEventsForRange();
  }, [loadEventsForRange]);

  const attorneys = useMemo(() => contacts.filter((c) => c.role === "attorney"), [contacts]);
  const paralegals = useMemo(() => contacts.filter((c) => c.role === "paralegal"), [contacts]);

  const contactById = useMemo(() => {
    const m = new Map<string, Contact>();
    for (const c of contacts) m.set(c.id, c);
    return m;
  }, [contacts]);

  const filteredSorted = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = rows.filter(({ event: e, case: c }) => {
      if (c.status !== "active") return false;
      if (!e.included || e.noiseFlag || e.completed) return false;
      const assign = c.assignedContactIds;
      const attorneyId = assign[0];
      const paralegalId = assign[1];
      if (attorneyFilter && attorneyId !== attorneyFilter) return false;
      if (paralegalFilter && paralegalId !== paralegalFilter) return false;
      if (eventKindFilter && (e.eventKind ?? "other_event") !== eventKindFilter) return false;
      if (!q) return true;
      const hay = [
        e.title,
        e.description,
        c.name,
        c.clientName,
        e.deponentOrSubject ?? "",
        e.externalAttendeesText ?? "",
      ]
        .join("\n")
        .toLowerCase();
      return hay.includes(q);
    });
    list.sort((a, b) => compareEventsBySchedule(a.event, b.event));
    return list;
  }, [rows, search, attorneyFilter, paralegalFilter, eventKindFilter]);

  const monthChips = useMemo(
    () =>
      filteredSorted.map(({ event: e, case: c }) => ({
        id: `${c.id}-${e.id}`,
        date: e.date,
        title: e.title,
        href: `/cases/${c.id}`,
        subtitle: c.clientName && c.clientName !== c.name ? `${c.name} · ${c.clientName}` : c.name,
        completed: e.completed,
      })),
    [filteredSorted]
  );

  if (!hydrated) return <PageSkeleton />;

  if (!isSupabaseConfigured()) {
    return (
      <PageWrapper>
        <p className="text-text-muted">Configure Supabase to use the calendar.</p>
      </PageWrapper>
    );
  }
  if (!user) return null;

  return (
    <PageWrapper>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-semibold tracking-tight text-text lg:text-3xl">Calendar</h1>
          <p className="mt-1 text-sm text-text-muted">
            {viewMode === "month" ? (
              <>
                Month view ·{" "}
                <span className="font-medium text-text">
                  {format(parseISO(`${monthCursor}-01`), "MMMM yyyy")}
                </span>
                {" "}
                <span className="text-text-dim">({format(parseISO(rangeStart), "MMM d")} – {format(parseISO(rangeEnd), "MMM d, yyyy")})</span>
              </>
            ) : (
              <>
                Showing{" "}
                <span className="font-medium text-text">
                  {format(parseISO(rangeStart), "MMM d, yyyy")} – {format(parseISO(rangeEnd), "MMM d, yyyy")}
                </span>
                {weeksEndOffsetDays > TWO_WEEKS_DAYS && (
                  <span className="text-text-dim"> ({weeksEndOffsetDays} days)</span>
                )}
              </>
            )}
          </p>
          <div className="mt-3 inline-flex rounded-lg border border-border bg-surface-alt p-0.5">
            <button
              type="button"
              onClick={() => setViewMode("timeline")}
              className={`rounded-md px-3 py-1.5 text-xs font-semibold transition sm:text-sm ${
                viewMode === "timeline"
                  ? "bg-primary text-white shadow-sm"
                  : "text-text-muted hover:text-text"
              }`}
            >
              Timeline
            </button>
            <button
              type="button"
              onClick={() => setViewMode("month")}
              className={`rounded-md px-3 py-1.5 text-xs font-semibold transition sm:text-sm ${
                viewMode === "month"
                  ? "bg-primary text-white shadow-sm"
                  : "text-text-muted hover:text-text"
              }`}
            >
              Month
            </button>
          </div>
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
            <Button variant="pink" size="lg">
              + New Case
            </Button>
          </Link>
        </div>
      </div>

      <Card className="mt-6">
        <CardBody className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            <div className="sm:col-span-2">
              <Label>Search</Label>
              <Input
                className="mt-1.5"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Title, case, client, description…"
              />
            </div>
            <div>
              <Label>Attorney</Label>
              <Select
                className="mt-1.5"
                value={attorneyFilter}
                onChange={(e) => setAttorneyFilter(e.target.value)}
              >
                <option value="">All attorneys</option>
                {attorneys.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label>Paralegal</Label>
              <Select
                className="mt-1.5"
                value={paralegalFilter}
                onChange={(e) => setParalegalFilter(e.target.value)}
              >
                <option value="">All paralegals</option>
                {paralegals.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label>Event type</Label>
              <Select
                className="mt-1.5"
                value={eventKindFilter}
                onChange={(e) => setEventKindFilter(e.target.value as EventKind | "")}
              >
                {EVENT_KIND_FILTER_OPTIONS.map((o) => (
                  <option key={o.value || "all"} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
            </div>
          </div>
        </CardBody>
      </Card>

      {loadError && (
        <div className="mt-6 rounded-lg border border-danger/20 bg-danger-light px-4 py-3" role="alert">
          <p className="text-sm text-danger">{loadError}</p>
        </div>
      )}

      {refreshing && !loadError && (
        <div className="mt-6 flex items-center gap-3">
          <Spinner className="h-4 w-4" />
          <p className="text-sm text-text-muted">Loading events…</p>
        </div>
      )}

      {viewMode === "month" ? (
        <div className="mt-6">
          <MonthlyEventCalendar month={monthCursor} chips={monthChips} onMonthChange={setMonthCursor} />
        </div>
      ) : (
        <div className="mt-6 max-h-[min(70vh,720px)] space-y-3 overflow-y-auto pr-1">
          {filteredSorted.map(({ event: e, case: c }) => {
            const assign = c.assignedContactIds;
            const att = assign[0] ? contactById.get(assign[0]) : undefined;
            const par = assign[1] ? contactById.get(assign[1]) : undefined;
            const kind = eventKindLabel(e.eventKind);
            return (
              <Link key={`${c.id}-${e.id}`} href={`/cases/${c.id}`}>
                <Card className="transition-shadow hover:shadow-md">
                  <CardBody className="py-4!">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <h2 className="text-base font-semibold text-text">{e.title}</h2>
                          <Badge variant={categoryBadgeVariant(e.category)}>{e.category}</Badge>
                          {isGoogleIcsMirrorEvent(e) && (
                            <span className="rounded-md bg-surface-alt px-2 py-0.5 text-xs font-medium text-text-secondary">
                              Originally from Google
                            </span>
                          )}
                          {kind && (
                            <span className="rounded-md bg-surface-alt px-2 py-0.5 text-xs font-medium text-text-secondary">
                              {kind}
                            </span>
                          )}
                        </div>
                        <p className="text-sm text-text-muted">
                          <span className="font-medium text-text-secondary">{c.name}</span>
                          {c.clientName && c.clientName !== c.name && (
                            <span> · {c.clientName}</span>
                          )}
                        </p>
                        {(e.description || e.deponentOrSubject) && (
                          <p className="line-clamp-2 text-xs text-text-dim">
                            {e.deponentOrSubject && (
                              <span className="font-medium text-text-muted">{e.deponentOrSubject} — </span>
                            )}
                            {e.description}
                          </p>
                        )}
                        {e.zoomLink?.trim() && (
                          <p className="text-xs font-semibold text-primary">
                            <span className="text-text-muted font-normal">Join: </span>
                            <span className="break-all">{e.zoomLink.trim()}</span>
                          </p>
                        )}
                      </div>
                      <div className="shrink-0 text-right text-sm">
                        <p className="font-medium tabular-nums text-text">{formatWhen(e)}</p>
                        <p className="mt-1 text-xs text-text-muted">
                          {att?.name ?? "—"}
                          <span className="text-text-dim"> · </span>
                          {par?.name ?? "—"}
                        </p>
                      </div>
                    </div>
                  </CardBody>
                </Card>
              </Link>
            );
          })}
        </div>
      )}

      {!refreshing && filteredSorted.length === 0 && !loadError && (
        <div className="mt-8">
          <EmptyState
            title={viewMode === "month" ? "No events this month" : "No events in this range"}
            description={
              viewMode === "month"
                ? "Try another month, clear filters, or add deadlines from a case."
                : "Adjust filters, load more weeks, or add deadlines from a case."
            }
            action={
              viewMode === "timeline" ? (
                <Button variant="secondary" onClick={() => setWeeksEndOffsetDays(TWO_WEEKS_DAYS)}>
                  Reset window
                </Button>
              ) : (
                <Button variant="secondary" onClick={() => setMonthCursor(format(new Date(), "yyyy-MM"))}>
                  Jump to current month
                </Button>
              )
            }
          />
        </div>
      )}

      <div className="mt-8 flex flex-wrap items-center justify-between gap-4 border-t border-border pt-6">
        <p className="text-sm text-text-muted">
          {filteredSorted.length} event{filteredSorted.length !== 1 ? "s" : ""} match your filters
          {viewMode === "timeline" ? " in this window." : " in this month."}
        </p>
        {viewMode === "timeline" ? (
          <Button
            variant="secondary"
            onClick={() => setWeeksEndOffsetDays((d) => d + TWO_WEEKS_DAYS)}
            disabled={refreshing}
          >
            Next 2 weeks
          </Button>
        ) : null}
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
          onSaved={() => void loadEventsForRange()}
        />
      )}
    </PageWrapper>
  );
}
