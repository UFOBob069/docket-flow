"use client";

import { useEffect, useRef, useState } from "react";
import { Input, Label } from "@/components/ui";

export type FilterOption = { id: string; label: string };

export function FilterMultiSelect({
  label,
  options,
  selectedIds,
  onChange,
  placeholder = "Select...",
}: {
  label: string;
  options: FilterOption[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      const target = e.target as Node | null;
      if (wrapRef.current && target && !wrapRef.current.contains(target)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  const selected = options.filter((o) => selectedIds.includes(o.id));
  const filtered = options.filter((o) =>
    o.label.toLowerCase().includes(query.trim().toLowerCase())
  );

  const toggle = (id: string) => {
    if (selectedIds.includes(id)) onChange(selectedIds.filter((x) => x !== id));
    else onChange([...selectedIds, id]);
  };

  return (
    <div ref={wrapRef}>
      <Label>{label}</Label>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="mt-1.5 flex min-h-11 w-full items-center justify-between gap-2 rounded-xl border border-border bg-white px-3 py-2 text-left text-sm shadow-sm transition hover:border-primary/40"
      >
        <div className="flex min-w-0 flex-1 flex-wrap gap-1">
          {selected.length === 0 ? (
            <span className="text-text-dim">{placeholder}</span>
          ) : (
            selected.map((s) => (
              <span
                key={s.id}
                className="inline-flex max-w-full items-center rounded-md bg-surface-alt px-2 py-0.5 text-xs text-text"
              >
                <span className="truncate">{s.label}</span>
              </span>
            ))
          )}
        </div>
        <span className="text-xs text-text-dim">{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <div className="relative z-40 mt-2 rounded-xl border border-border bg-white p-2 shadow-xl">
          <Input
            className="mb-2"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={`Search ${label.toLowerCase()}...`}
          />
          <div className="max-h-56 overflow-y-auto">
            {filtered.map((o) => (
              <label
                key={o.id}
                className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 hover:bg-surface-alt"
              >
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-border text-primary"
                  checked={selectedIds.includes(o.id)}
                  onChange={() => toggle(o.id)}
                />
                <span className="truncate text-sm">{o.label}</span>
              </label>
            ))}
            {filtered.length === 0 && (
              <p className="px-2 py-2 text-xs text-text-dim">No matches.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
