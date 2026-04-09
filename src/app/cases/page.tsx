"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { getDb } from "@/lib/firebase/client";
import { isFirebaseConfigured } from "@/lib/firebase/config";
import { subscribeCases, subscribeContacts } from "@/lib/firestore/repo";
import type { Case, Contact } from "@/lib/types";
import { PageSkeleton } from "@/components/PageSkeleton";
import { useHydrated } from "@/hooks/useHydrated";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  PageHeader,
  PageWrapper,
} from "@/components/ui";

export default function CasesListPage() {
  const router = useRouter();
  const hydrated = useHydrated();
  const { user, loading, firebaseReady } = useAuth();
  const [cases, setCases] = useState<Case[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [search, setSearch] = useState("");
  const [attorneyId, setAttorneyId] = useState<string | null>(null);

  useEffect(() => {
    if (!firebaseReady || loading || !user) return;
    const db = getDb();
    const unsubCases = subscribeCases(db, setCases);
    const unsubContacts = subscribeContacts(db, setContacts);
    return () => {
      unsubCases();
      unsubContacts();
    };
  }, [user, loading, firebaseReady]);

  useEffect(() => {
    if (!loading && firebaseReady && !user) router.replace("/login");
  }, [user, loading, firebaseReady, router]);

  if (!hydrated) return <PageSkeleton />;

  if (!isFirebaseConfigured()) {
    return (
      <PageWrapper>
        <p className="text-text-muted">Configure Firebase to view cases.</p>
      </PageWrapper>
    );
  }

  if (!user) return null;

  const attorneys = contacts
    .filter((ct) => ct.role === "attorney")
    .sort((a, b) => a.name.localeCompare(b.name));

  const q = search.toLowerCase().trim();
  let filtered = cases;
  if (attorneyId) {
    filtered = filtered.filter((c) => c.assignedContactIds?.includes(attorneyId));
  }
  if (q) {
    filtered = filtered.filter(
      (c) =>
        c.clientName?.toLowerCase().includes(q) ||
        c.name?.toLowerCase().includes(q) ||
        c.causeNumber?.toLowerCase().includes(q)
    );
  }

  const hasFilters = Boolean(attorneyId || q);

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
          {attorneys.length > 0 && (
            <div className="mt-8 flex flex-wrap items-center gap-2">
              <span className="mr-1 text-xs font-medium uppercase tracking-wide text-text-dim">
                Attorney
              </span>
              <button
                type="button"
                onClick={() => setAttorneyId(null)}
                className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                  attorneyId === null
                    ? "border-primary bg-primary-light text-primary"
                    : "border-border bg-white text-text-secondary hover:bg-surface-alt"
                }`}
              >
                All
              </button>
              {attorneys.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  onClick={() =>
                    setAttorneyId((prev) => (prev === a.id ? null : a.id))
                  }
                  className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                    attorneyId === a.id
                      ? "border-primary bg-primary-light text-primary"
                      : "border-border bg-white text-text-secondary hover:bg-surface-alt"
                  }`}
                >
                  {a.name}
                </button>
              ))}
            </div>
          )}
          <div className="relative mt-6">
            <svg
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-dim"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={2}
              stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
            </svg>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by client name, case name, or cause number…"
              className="w-full rounded-lg border border-border bg-surface py-2.5 pl-10 pr-4 text-sm text-text placeholder:text-text-dim focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
            />
          </div>

          {filtered.length === 0 ? (
            <p className="mt-6 text-center text-sm text-text-muted">
              {q
                ? `No cases match “${search}”.`
                : attorneyId
                  ? "No cases assigned to this attorney."
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
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  {c.causeNumber && (
                    <span className="text-xs text-text-dim">
                      Cause {c.causeNumber}
                    </span>
                  )}
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
