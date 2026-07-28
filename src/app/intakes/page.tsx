"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { format, parseISO } from "date-fns";
import { useAuth } from "@/context/AuthContext";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import type { IntakeListItem } from "@/lib/intake-types";
import { useIntakeApi } from "@/hooks/useIntakeApi";
import { useHydrated } from "@/hooks/useHydrated";
import { PageSkeleton } from "@/components/PageSkeleton";
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
} from "@/components/ui";

function formatWhen(iso: string | null): string {
  if (!iso) return "—";
  try {
    return format(parseISO(iso), "MMM d, yyyy h:mm a");
  } catch {
    return iso;
  }
}

export default function IntakesListPage() {
  const router = useRouter();
  const hydrated = useHydrated();
  const { user, loading, supabaseReady } = useAuth();
  const api = useIntakeApi();
  const [items, setItems] = useState<IntakeListItem[]>([]);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<"open" | "promoted" | "all">("open");
  const [searchInput, setSearchInput] = useState("");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!api.ready) return;
    setRefreshing(true);
    setLoadError(null);
    try {
      const params = new URLSearchParams({ status });
      if (q.trim()) params.set("q", q.trim());
      const data = await api.get<{ items: IntakeListItem[] }>(`/api/intakes?${params}`);
      setItems(data.items);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Failed to load intakes");
    } finally {
      setRefreshing(false);
    }
  }, [api, q, status]);

  useEffect(() => {
    if (!supabaseReady || loading || !user) return;
    void load();
  }, [user, loading, supabaseReady, load]);

  useEffect(() => {
    if (!loading && supabaseReady && !user) router.replace("/login");
  }, [user, loading, supabaseReady, router]);

  if (!hydrated) return <PageSkeleton />;
  if (!isSupabaseConfigured()) {
    return (
      <PageWrapper>
        <p className="text-text-muted">Configure Supabase.</p>
      </PageWrapper>
    );
  }
  if (!user) return null;

  return (
    <PageWrapper>
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-text">Intakes</h1>
          <p className="mt-1 text-sm text-text-muted">
            Live call intakes before they become cases. Edit fields here — the router only fills blanks.
          </p>
        </div>
        <Button variant="secondary" size="sm" disabled={refreshing} onClick={() => void load()}>
          {refreshing ? "Refreshing…" : "Refresh"}
        </Button>
      </div>

      <Card className="mb-6">
        <CardBody className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex-1">
            <Label>Search name or phone</Label>
            <Input
              className="mt-1.5"
              value={searchInput}
              placeholder="e.g. Smith or 512…"
              onChange={(e) => setSearchInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") setQ(searchInput);
              }}
            />
          </div>
          <div className="w-full sm:w-40">
            <Label>Status</Label>
            <Select
              className="mt-1.5"
              value={status}
              onChange={(e) => setStatus(e.target.value as typeof status)}
            >
              <option value="open">Open</option>
              <option value="promoted">Promoted</option>
              <option value="all">All</option>
            </Select>
          </div>
          <Button className="shrink-0" onClick={() => setQ(searchInput)}>
            Search
          </Button>
        </CardBody>
      </Card>

      {loadError && (
        <p className="mb-4 rounded-lg border border-danger/30 bg-danger-light px-3 py-2 text-sm text-danger">
          {loadError}
        </p>
      )}

      {items.length === 0 && !refreshing ? (
        <EmptyState title="No intakes" description="Try a different search or status filter." />
      ) : (
        <div className="divide-y divide-border rounded-xl border border-border bg-white shadow-sm">
          {items.map((row) => {
            const callId = row.call_id;
            if (!callId) return null;
            const promoted = Boolean(row.case_id);
            return (
              <Link
                key={row.id}
                href={`/intakes/${encodeURIComponent(callId)}`}
                className="flex flex-col gap-2 px-4 py-4 transition hover:bg-surface-alt sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium text-text">{row.name?.trim() || "Unnamed intake"}</p>
                  <p className="mt-0.5 text-sm text-text-muted">
                    {[row.phone, row.accident_date, row.how_found].filter(Boolean).join(" · ") || "No details yet"}
                  </p>
                  {row.notes && (
                    <p className="mt-1 line-clamp-2 text-xs text-text-secondary">{row.notes}</p>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-2 text-xs text-text-muted">
                  {promoted ? (
                    <Badge variant="success">Promoted</Badge>
                  ) : (
                    <Badge variant="primary">Open</Badge>
                  )}
                  <span>{formatWhen(row.created_at)}</span>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </PageWrapper>
  );
}
