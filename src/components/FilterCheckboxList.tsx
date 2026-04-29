"use client";

import { Label } from "@/components/ui";

type Option = { id: string; label: string };

export function FilterCheckboxList({
  label,
  options,
  selectedIds,
  onChange,
  emptyHint,
}: {
  label: string;
  options: Option[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  emptyHint?: string;
}) {
  const toggle = (id: string) => {
    if (selectedIds.includes(id)) onChange(selectedIds.filter((x) => x !== id));
    else onChange([...selectedIds, id]);
  };

  return (
    <div>
      <Label>{label}</Label>
      {emptyHint && options.length === 0 ? (
        <p className="mt-1 text-xs text-text-dim">{emptyHint}</p>
      ) : null}
      <div className="mt-1.5 max-h-36 overflow-y-auto rounded-lg border border-border bg-white p-2 text-xs">
        {options.length === 0 ? (
          <p className="text-text-muted">None</p>
        ) : (
          options.map((o) => (
            <label
              key={o.id}
              className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 hover:bg-surface-alt"
            >
              <input
                type="checkbox"
                className="h-3.5 w-3.5 shrink-0 rounded border-border text-primary"
                checked={selectedIds.includes(o.id)}
                onChange={() => toggle(o.id)}
              />
              <span className="min-w-0 truncate">{o.label}</span>
            </label>
          ))
        )}
      </div>
      {selectedIds.length > 0 ? (
        <button
          type="button"
          className="mt-1 text-[11px] font-medium text-primary hover:underline"
          onClick={() => onChange([])}
        >
          Clear
        </button>
      ) : null}
    </div>
  );
}
