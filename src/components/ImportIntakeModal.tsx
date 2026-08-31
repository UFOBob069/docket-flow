"use client";

import { useEffect, useState } from "react";
import type { IntakeListItem } from "@/lib/intake-types";
import { formatIntakeWhen } from "@/lib/intake-detail";
import { Button, Card, CardBody, Input, Spinner } from "@/components/ui";

type Props = {
  caseId: string;
  idToken: string | null;
  onClose: () => void;
  onImported: (summary: string) => void;
};

export function ImportIntakeModal({ caseId, idToken, onClose, onImported }: Props) {
  const [q, setQ] = useState("");
  const [items, setItems] = useState<IntakeListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyCallId, setBusyCallId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!idToken) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void (async () => {
        setLoading(true);
        setError(null);
        try {
          const params = new URLSearchParams({
            status: "open",
            limit: "30",
          });
          if (q.trim()) params.set("q", q.trim());
          const res = await fetch(`/api/intakes?${params}`, {
            headers: { Authorization: `Bearer ${idToken}` },
          });
          const json = (await res.json()) as { items?: IntakeListItem[]; error?: string };
          if (!res.ok) throw new Error(json.error ?? "Failed to load intakes");
          if (!cancelled) setItems(json.items ?? []);
        } catch (e) {
          if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load intakes");
        } finally {
          if (!cancelled) setLoading(false);
        }
      })();
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [idToken, q]);

  async function importIntake(callId: string | null) {
    if (!idToken || !callId) return;
    if (
      !window.confirm(
        "Import this intake into the case?\n\nOnly blank case and Case Tracker fields will be filled. Existing values will not be overwritten. The intake will be linked to this case."
      )
    ) {
      return;
    }
    setBusyCallId(callId);
    setError(null);
    try {
      const res = await fetch(`/api/cases/${encodeURIComponent(caseId)}/import-intake`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ callId }),
      });
      const json = (await res.json()) as {
        error?: string;
        linked?: boolean;
        caseFieldsUpdated?: string[];
        trackerFieldsUpdated?: string[];
      };
      if (!res.ok) throw new Error(json.error ?? "Import failed");
      const bits = [
        json.linked ? "linked intake" : null,
        json.caseFieldsUpdated?.length
          ? `${json.caseFieldsUpdated.length} case field(s)`
          : null,
        json.trackerFieldsUpdated?.length
          ? `${json.trackerFieldsUpdated.length} Case Tracker field(s)`
          : null,
      ].filter(Boolean);
      onImported(bits.length ? `Imported intake (${bits.join("; ")})` : "Intake already linked; nothing blank to fill");
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Import failed");
    } finally {
      setBusyCallId(null);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        className="absolute inset-0 bg-black/30"
        aria-label="Close"
        onClick={onClose}
      />
      <Card className="relative z-10 w-[min(92vw,520px)] max-h-[85vh] overflow-hidden rounded-2xl shadow-2xl">
        <CardBody className="space-y-3 !p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="text-base font-semibold text-text">Import from intake</h3>
              <p className="mt-1 text-xs text-text-muted">
                Choose an open intake. Blank case / Case Tracker fields are filled; existing data is kept.
              </p>
            </div>
            <Button variant="ghost" size="sm" onClick={onClose}>
              Close
            </Button>
          </div>

          <Input
            placeholder="Search name or phone…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            autoFocus
          />

          {error && (
            <p className="rounded-lg border border-danger/20 bg-danger-light px-3 py-2 text-sm text-danger" role="alert">
              {error}
            </p>
          )}

          <div className="max-h-[50vh] space-y-2 overflow-y-auto pr-1">
            {loading && (
              <div className="flex items-center gap-2 py-6 text-sm text-text-muted">
                <Spinner className="h-4 w-4" />
                Loading intakes…
              </div>
            )}
            {!loading && items.length === 0 && (
              <p className="py-6 text-sm text-text-muted">No open intakes found.</p>
            )}
            {!loading &&
              items.map((item) => {
                const callId = item.call_id;
                const busy = busyCallId === callId;
                return (
                  <div
                    key={item.id}
                    className="flex items-start justify-between gap-3 rounded-xl border border-border bg-white px-3 py-2.5"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-text">
                        {item.name?.trim() || "Unnamed intake"}
                      </p>
                      <p className="mt-0.5 text-xs text-text-muted">
                        {[item.phone?.trim(), item.accident_date?.trim() ? `DOI ${item.accident_date}` : null, formatIntakeWhen(item.created_at)]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                    </div>
                    <Button
                      size="sm"
                      disabled={!callId || Boolean(busyCallId)}
                      onClick={() => void importIntake(callId)}
                    >
                      {busy ? "Importing…" : "Import"}
                    </Button>
                  </div>
                );
              })}
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
