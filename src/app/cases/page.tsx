"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { getBrowserSupabase } from "@/lib/supabase/singleton";
import { caseMatchesAssignedRole } from "@/lib/case-assigned-filter";
import { fetchCasesWithEvents, subscribeCases, subscribeContacts } from "@/lib/supabase/repo";
import { EVENT_KIND_FILTER_OPTIONS } from "@/lib/one-off-events";
import type { CalendarEvent, Case, Contact, EventKind } from "@/lib/types";
import { FilterCheckboxList } from "@/components/FilterCheckboxList";
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
  PageHeader,
  PageWrapper,
} from "@/components/ui";

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

  const cases = useMemo(() => bundled.map((b) => b.case), [bundled]);
  const eventsByCaseId = useMemo(() => {
    const m = new Map<string, CalendarEvent[]>();
    for (const b of bundled) m.set(b.case.id, b.events);
    return m;
  }, [bundled]);

  useEffect(() => {
    if (!supabaseReady || loading || !user) return;
    const supabase = getBrowserSupabase();
    const loadBundled = () => {
      void (async () => {
        const rows = await fetchCasesWithEvents(supabase, user.id);
        setBundled(rows);
      })();
    };
    loadBundled();
    const unsubCases = subscribeCases(supabase, user.id, loadBundled);
    const unsubContacts = subscribeContacts(supabase, user.id, setContacts);
    return () => {
      unsubCases();
      unsubContacts();
    };
  }, [user, loading, supabaseReady]);

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
    return list;
  }, [
    cases,
    search,
    attorneyFilterIds,
    paralegalFilterIds,
    eventKindFilters,
    contactById,
    eventsByCaseId,
  ]);

  const hasFilters = Boolean(
    attorneyFilterIds.length || paralegalFilterIds.length || search.trim() || eventKindFilters.length
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
      <PageHeader
        title="Cases"
        subtitle={
          hasFilters
            ? `${filtered.length} shown · ${cases.length} total`
            : `${cases.length} case${cases.length !== 1 ? "s" : ""}`
        }
        actions={
          <Link href="/cases/new">
            <Button variant="pink" size="lg">+ New Case</Button>
          </Link>
        }
      />

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
          <Card className="mt-6">
            <CardBody className="space-y-4">
              <div className="grid items-start gap-4 sm:grid-cols-2 lg:grid-cols-6">
                <div className="sm:col-span-2">
                  <Label>Search</Label>
                  <Input
                    className="mt-1.5"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Client, case number, attorney, paralegal, notes…"
                  />
                </div>
                <FilterCheckboxList
                  label="Attorneys"
                  options={attorneys.map((a) => ({ id: a.id, label: a.name }))}
                  selectedIds={attorneyFilterIds}
                  onChange={setAttorneyFilterIds}
                  emptyHint="Add attorneys under Contacts."
                />
                <FilterCheckboxList
                  label="Paralegals"
                  options={paralegals.map((p) => ({ id: p.id, label: p.name }))}
                  selectedIds={paralegalFilterIds}
                  onChange={setParalegalFilterIds}
                  emptyHint="Add paralegals under Contacts."
                />
                <div className="sm:col-span-2">
                  <FilterCheckboxList
                    label="Event types"
                    options={eventKindCheckboxOptions}
                    selectedIds={eventKindFilters}
                    onChange={(ids) => setEventKindFilters(ids as EventKind[])}
                  />
                </div>
              </div>
            </CardBody>
          </Card>

          {filtered.length === 0 ? (
            <p className="mt-6 text-center text-sm text-text-muted">
              {search.trim()
                ? `No cases match your search.`
                : attorneyFilterIds.length || paralegalFilterIds.length || eventKindFilters.length
                  ? "No cases match these filters."
                  : "No cases match your filters."}
            </p>
          ) : (
            <Card className="mt-4">
              <div className="divide-y divide-border">
                {filtered.map((c) => (
                  <Link
                    key={c.id}
                    href={`/cases/${c.id}`}
                    className="flex flex-col gap-1.5 px-6 py-4 transition-colors hover:bg-surface-alt sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-text">
                        {c.name}
                      </p>
                      <p className="truncate text-sm text-text-muted">
                        {c.clientName}
                      </p>
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
                      <Badge variant={c.status === "active" ? "success" : "default"}>
                        {c.status}
                      </Badge>
                      <svg className="h-4 w-4 text-text-dim" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                      </svg>
                    </div>
                  </Link>
                ))}
              </div>
            </Card>
          )}
        </>
      )}
    </PageWrapper>
  );
}
