"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { getDb } from "@/lib/firebase/client";
import { isFirebaseConfigured } from "@/lib/firebase/config";
import { subscribeCases } from "@/lib/firestore/repo";
import type { Case } from "@/lib/types";
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

  useEffect(() => {
    if (!firebaseReady || loading || !user) return;
    const db = getDb();
    const unsub = subscribeCases(db, setCases);
    return () => unsub();
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

  return (
    <PageWrapper>
      <PageHeader
        title="Cases"
        subtitle={`${cases.length} case${cases.length !== 1 ? "s" : ""}`}
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
        <Card className="mt-8">
          <div className="divide-y divide-border">
            {cases.map((c) => (
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
    </PageWrapper>
  );
}
