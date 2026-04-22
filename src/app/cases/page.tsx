"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { getBrowserSupabase } from "@/lib/supabase/singleton";
import { subscribeCases, subscribeContacts } from "@/lib/supabase/repo";
import type { Case, Contact } from "@/lib/types";
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
  Select,
} from "@/components/ui";

export default function CasesListPage() {
  const router = useRouter();
  const hydrated = useHydrated();
  const { user, loading, supabaseReady } = useAuth();
  const [cases, setCases] = useState<Case[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [search, setSearch] = useState("");
  const [attorneyFilter, setAttorneyFilter] = useState("");
  const [paralegalFilter, setParalegalFilter] = useState("");

  useEffect(() => {
    if (!supabaseReady || loading || !user) return;
    const supabase = getBrowserSupabase();
    const unsubCases = subscribeCases(supabase, user.id, setCases);
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

  const filtered = useMemo(() => {
    let list = cases;
    if (attorneyFilter) {
      list = list.filter((c) => c.assignedContactIds[0] === attorneyFilter);
    }
    if (paralegalFilter) {
      list = list.filter((c) => c.assignedContactIds[1] === paralegalFilter);
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
  }, [cases, search, attorneyFilter, paralegalFilter, contactById]);

  const hasFilters = Boolean(attorneyFilter || paralegalFilter || search.trim());

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
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <div className="sm:col-span-2">
                  <Label>Search</Label>
                  <Input
                    className="mt-1.5"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Client, case number, attorney, paralegal, notes…"
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
                    {attorneys.map((a) => (
                      <option key={a.id} value={a.id}>{a.name}</option>
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
                    {paralegals.map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </Select>
                </div>
              </div>
            </CardBody>
          </Card>

          {filtered.length === 0 ? (
            <p className="mt-6 text-center text-sm text-text-muted">
              {search.trim()
                ? `No cases match your search.`
                : attorneyFilter || paralegalFilter
                  ? "No cases match these assignee filters."
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
