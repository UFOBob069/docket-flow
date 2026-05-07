"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { addDays, format, parseISO } from "date-fns";
import { useAuth } from "@/context/AuthContext";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { getBrowserSupabase } from "@/lib/supabase/singleton";
import { caseMatchesAssignedRole } from "@/lib/case-assigned-filter";
import {
  fetchCasesWithEvents,
  subscribeCaseEventsFirm,
  subscribeCases,
  subscribeContacts,
} from "@/lib/supabase/repo";
import { EVENT_KIND_FILTER_OPTIONS } from "@/lib/one-off-events";
import type { CalendarEvent, Case, Contact, EventKind } from "@/lib/types";
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
} from "@/components/ui";

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

const DEFAULT_SPAN_DAYS = 14;

function defaultEndFromStart(startYmd: string): string {
  return format(addDays(parseISO(startYmd), DEFAULT_SPAN_DAYS - 1), "yyyy-MM-dd");
}

function formatRangePill(start: string, end: string): string {
  return `${format(parseISO(start), "MMM d")} - ${format(parseISO(end), "MMM d")}`;
}

function eventInDateRange(ev: CalendarEvent, start: string, end: string): boolean {
  return ev.date >= start && ev.date <= end;
}

function caseNumberSortKey(c: Case): number | null {
  const raw = (c.caseNumber ?? c.causeNumber ?? "").trim();
  if (!raw) return null;
  const digitsOnly = raw.replace(/\D+/g, "");
  if (!digitsOnly) return null;
  const n = Number.parseInt(digitsOnly, 10);
  return Number.isFinite(n) ? n : null;
}

function compareCasesByCaseNumber(a: Case, b: Case): number {
  const aNum = caseNumberSortKey(a);
  const bNum = caseNumberSortKey(b);
  if (aNum !== null && bNum !== null && aNum !== bNum) return aNum - bNum;
  if (aNum !== null && bNum === null) return -1;
  if (aNum === null && bNum !== null) return 1;

  const aRaw = (a.caseNumber ?? a.causeNumber ?? "").trim();
  const bRaw = (b.caseNumber ?? b.causeNumber ?? "").trim();
  const rawCmp = aRaw.localeCompare(bRaw, undefined, { numeric: true, sensitivity: "base" });
  if (rawCmp !== 0) return rawCmp;

  return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
}

export default function CasesListPage() {
  const router = useRouter();
  const hydrated = useHydrated();
  const { user, loading, supabaseReady } = useAuth();
  const [bundled, setBundled] = useState<{ case: Case; events: CalendarEvent[] }[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [search, setSearch] = useState("");
  const [attorneyFilterIds, setAttorneyFilterIds] = useState<string[]>([]);
  const [paralegalFilterIds, setParalegalFilterIds] = useState<string[]>([]);
  const [eventKindFilters, setEventKindFilters] = useState<EventKind[]>([]);
  const [showFiltersDrawer, setShowFiltersDrawer] = useState(false);
  const [showDateModal, setShowDateModal] = useState(false);

  const [timelineStart, setTimelineStart] = useState(() => todayIso());
  const [timelineEnd, setTimelineEnd] = useState(() => defaultEndFromStart(todayIso()));
  const [useEventDateFilter, setUseEventDateFilter] = useState(false);

  const cases = useMemo(() => bundled.map((b) => b.case), [bundled]);
  const eventsByCaseId = useMemo(() => {
    const m = new Map<string, CalendarEvent[]>();
    for (const b of bundled) m.set(b.case.id, b.events);
    return m;
  }, [bundled]);

  const loadBundled = useCallback(() => {
    if (!user?.id) return;
    void (async () => {
      try {
        const supabase = getBrowserSupabase();
        const rows = await fetchCasesWithEvents(supabase, user.id);
        setBundled(rows);
      } catch (e) {
        console.warn("[cases] fetchCasesWithEvents", e);
      }
    })();
  }, [user?.id]);

  useEffect(() => {
    if (!supabaseReady || loading || !user) return;
    const supabase = getBrowserSupabase();
    loadBundled();
    const unsubCases = subscribeCases(supabase, user.id, loadBundled);
    const unsubEvents = subscribeCaseEventsFirm(supabase, user.id, loadBundled);
    const unsubContacts = subscribeContacts(supabase, user.id, setContacts);
    return () => {
      unsubCases();
      unsubEvents();
      unsubContacts();
    };
  }, [user, loading, supabaseReady, loadBundled]);

  /** Refetch when returning to the tab (Realtime may be off or delayed). */
  useEffect(() => {
    if (!supabaseReady || loading || !user) return;
    const onVisible = () => {
      if (document.visibilityState === "visible") loadBundled();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [supabaseReady, loading, user, loadBundled]);

  useEffect(() => {
    if (!loading && supabaseReady && !user) router.replace("/login");
  }, [user, loading, supabaseReady, router]);

  const contactById = useMemo(() => {
    const m = new Map<string, Contact>();
    for (const ct of contacts) m.set(ct.id, ct);
    return m;
  }, [contacts]);

  const attorneys = useMemo(
    () => contacts.filter((ct) => ct.role === "attorney").sort((a, b) => a.name.localeCompare(b.name)),
    [contacts]
  );
  const paralegals = useMemo(
    () => contacts.filter((ct) => ct.role === "paralegal").sort((a, b) => a.name.localeCompare(b.name)),
    [contacts]
  );

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

  const resetDateFilter = () => {
    const s = todayIso();
    setTimelineStart(s);
    setTimelineEnd(defaultEndFromStart(s));
    setUseEventDateFilter(false);
  };

  const filtered = useMemo(() => {
    let list = cases;
    list = list.filter((c) => caseMatchesAssignedRole(c, attorneyFilterIds, "attorney", contactById));
    list = list.filter((c) => caseMatchesAssignedRole(c, paralegalFilterIds, "paralegal", contactById));
    if (eventKindFilters.length) {
      list = list.filter((c) => {
        const evs = eventsByCaseId.get(c.id) ?? [];
        return evs.some((e) => eventKindFilters.includes((e.eventKind ?? "other_event") as EventKind));
      });
    }
    if (useEventDateFilter) {
      list = list.filter((c) => {
        const evs = eventsByCaseId.get(c.id) ?? [];
        return evs.some((e) => eventInDateRange(e, timelineStart, timelineEnd));
      });
    }
    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter((c) => {
        const assignBits = c.assignedContactIds
          .map((id) => {
            const ct = contactById.get(id);
            return ct ? `${ct.name} ${ct.email} ${ct.role}` : "";
          })
          .join(" ");
        const hay = [
          c.name,
          c.clientName,
          c.caseNumber ?? "",
          c.causeNumber ?? "",
          c.notes ?? "",
          assignBits,
        ]
          .join("\n")
          .toLowerCase();
        return hay.includes(q);
      });
    }
    return [...list].sort(compareCasesByCaseNumber);
  }, [
    cases,
    search,
    attorneyFilterIds,
    paralegalFilterIds,
    eventKindFilters,
    contactById,
    eventsByCaseId,
    useEventDateFilter,
    timelineStart,
    timelineEnd,
  ]);

  const activeFilterCount =
    (attorneyFilterIds.length ? 1 : 0) +
    (paralegalFilterIds.length ? 1 : 0) +
    (eventKindFilters.length ? 1 : 0) +
    (useEventDateFilter ? 1 : 0);

  function clearAllFilters() {
    setAttorneyFilterIds([]);
    setParalegalFilterIds([]);
    setEventKindFilters([]);
    resetDateFilter();
  }

  const hasFilters = Boolean(
    attorneyFilterIds.length ||
      paralegalFilterIds.length ||
      search.trim() ||
      eventKindFilters.length ||
      useEventDateFilter
  );

  if (!hydrated) return <PageSkeleton />;

  if (!isSupabaseConfigured()) {
    return (
      <PageWrapper>
        <p className="text-text-muted">Configure Supabase to view cases.</p>
      </PageWrapper>
    );
  }

  if (!user) return null;

  return (
    <PageWrapper>
      <h1 className="text-2xl font-semibold tracking-tight text-text lg:text-3xl">Cases</h1>
      <p className="mt-1 text-sm text-text-muted">
        {hasFilters
          ? `${filtered.length} shown · ${cases.length} total`
          : `${cases.length} case${cases.length !== 1 ? "s" : ""}`}
        {useEventDateFilter && (
          <span className="text-text-dim">
            {" "}
            · With an event in {formatRangePill(timelineStart, timelineEnd)}
          </span>
        )}
      </p>

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
          {useEventDateFilter ? formatRangePill(timelineStart, timelineEnd) : "All dates"}
        </button>
        <Button variant="secondary" onClick={() => setShowFiltersDrawer(true)}>
          Filters{activeFilterCount ? ` (${activeFilterCount})` : ""}
        </Button>
        <Link href="/cases/new">
          <Button variant="pink">+ New Case</Button>
        </Link>
      </div>

      {Boolean(
        attorneyFilterIds.length ||
          paralegalFilterIds.length ||
          eventKindFilters.length ||
          useEventDateFilter
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
          {useEventDateFilter && (
            <button
              type="button"
              onClick={resetDateFilter}
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
                <h3 className="text-base font-semibold text-text">Event date range</h3>
                <button
                  type="button"
                  className="text-xs font-medium text-primary hover:underline"
                  onClick={resetDateFilter}
                >
                  Clear filter
                </button>
              </div>
              <p className="text-xs text-text-muted">
                Show only cases that have at least one event with a date in this range. Leave cleared to list all
                cases (other filters still apply).
              </p>
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
                      setUseEventDateFilter(true);
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
                      setUseEventDateFilter(true);
                    }}
                  />
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="secondary" onClick={() => setShowDateModal(false)}>
                  Cancel
                </Button>
                <Button
                  type="button"
                  onClick={() => {
                    setUseEventDateFilter(true);
                    setShowDateModal(false);
                  }}
                >
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
              <Label>Event date range</Label>
              <button
                type="button"
                onClick={() => setShowDateModal(true)}
                className="mt-1.5 w-full rounded-xl border border-border bg-white px-3 py-2 text-left text-sm shadow-sm transition hover:border-primary/40"
              >
                {useEventDateFilter ? formatRangePill(timelineStart, timelineEnd) : "All dates — tap to filter"}
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

      {cases.length === 0 ? (
        <div className="mt-10">
          <EmptyState
            title="No cases yet"
            description="Create your first case to start extracting deadlines."
            action={
              <Link href="/cases/new">
                <Button>Create a case</Button>
              </Link>
            }
          />
        </div>
      ) : (
        <>
          {filtered.length === 0 ? (
            <p className="mt-6 text-center text-sm text-text-muted">
              {search.trim()
                ? `No cases match your search.`
                : attorneyFilterIds.length || paralegalFilterIds.length || eventKindFilters.length || useEventDateFilter
                  ? "No cases match these filters."
                  : "No cases match your filters."}
            </p>
          ) : (
            <Card className="mt-6">
              <div className="divide-y divide-border">
                {filtered.map((c) => {
                  const evs = eventsByCaseId.get(c.id) ?? [];
                  const evCount = evs.length;
                  const today = todayIso();
                  const overdueCount = evs.filter(
                    (e) => e.included && !e.completed && !e.noiseFlag && e.date < today
                  ).length;
                  return (
                    <Link
                      key={c.id}
                      href={`/cases/${c.id}`}
                      className="flex flex-col gap-1.5 px-6 py-4 transition-colors hover:bg-surface-alt sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-text">{c.name}</p>
                        <p className="truncate text-sm text-text-muted">{c.clientName}</p>
                        {(c.caseNumber || c.causeNumber) && (
                          <p className="mt-0.5 truncate text-xs text-text-dim">
                            {c.caseNumber && <span>Case #{c.caseNumber}</span>}
                            {c.caseNumber && c.causeNumber && c.caseNumber !== c.causeNumber && (
                              <span> · </span>
                            )}
                            {c.causeNumber && c.caseNumber !== c.causeNumber && (
                              <span>Cause {c.causeNumber}</span>
                            )}
                          </p>
                        )}
                      </div>
                      <div className="flex shrink-0 items-center gap-3">
                        <span className="rounded-full bg-surface-alt px-2.5 py-0.5 text-xs font-medium tabular-nums text-text-secondary">
                          {evCount} event{evCount !== 1 ? "s" : ""}
                        </span>
                        {overdueCount > 0 && (
                          <Badge variant="danger">
                            {overdueCount} overdue
                          </Badge>
                        )}
                        <Badge variant={c.status === "active" ? "success" : "default"}>{c.status}</Badge>
                        <svg
                          className="h-4 w-4 text-text-dim"
                          fill="none"
                          viewBox="0 0 24 24"
                          strokeWidth={1.5}
                          stroke="currentColor"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            d="M8.25 4.5l7.5 7.5-7.5 7.5"
                          />
                        </svg>
                      </div>
                    </Link>
                  );
                })}
              </div>
            </Card>
          )}
        </>
      )}
    </PageWrapper>
  );
}
