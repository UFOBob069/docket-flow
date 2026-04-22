"use client";

import { REMINDER_OPTIONS, labelForMinutes } from "@/lib/reminder-presets";
import { Label } from "@/components/ui";

const MAX_REMINDERS = 5;

type Props = {
  value: number[];
  onChange: (minutes: number[]) => void;
  /** Shown under the label */
  hint?: string;
};

export function ReminderMinutesEditor({ value, onChange, hint }: Props) {
  return (
    <div>
      <Label>Reminders</Label>
      {hint && <p className="mt-1 text-xs text-text-dim">{hint}</p>}
      <div className="mt-2 flex flex-wrap gap-1.5">
        {value.map((m, i) => (
          <div
            key={`${m}-${i}`}
            className="flex items-center gap-1 rounded-full border border-border bg-surface-alt px-2.5 py-1"
          >
            <select
              className="max-w-[200px] bg-transparent text-xs text-text outline-none"
              value={m}
              onChange={(e) => {
                const next = [...value];
                next[i] = Number(e.target.value);
                onChange(next);
              }}
            >
              {REMINDER_OPTIONS.map((opt) => (
                <option key={opt.minutes} value={opt.minutes}>
                  {opt.label}
                </option>
              ))}
              {!REMINDER_OPTIONS.some((o) => o.minutes === m) && (
                <option value={m}>{labelForMinutes(m)}</option>
              )}
            </select>
            <button
              type="button"
              className="text-[10px] text-text-dim hover:text-danger"
              onClick={() => onChange(value.filter((_, j) => j !== i))}
            >
              ✕
            </button>
          </div>
        ))}
        {value.length < MAX_REMINDERS && (
          <button
            type="button"
            className="rounded-full border border-dashed border-primary/40 px-2.5 py-1 text-xs font-medium text-primary transition hover:bg-primary-light"
            onClick={() => {
              const used = new Set(value);
              const next =
                REMINDER_OPTIONS.find((o) => !used.has(o.minutes))?.minutes ?? 1440;
              onChange([...value, next]);
            }}
          >
            + Add
          </button>
        )}
      </div>
      <p className="mt-2 text-xs text-text-muted">
        Up to {MAX_REMINDERS} alerts sync to Google Calendar. Email reminders use day-based offsets
        when configured.
      </p>
    </div>
  );
}
