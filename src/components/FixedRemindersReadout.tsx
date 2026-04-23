"use client";

import { formatReminderMinutesList } from "@/lib/reminder-presets";

export function FixedRemindersReadout({
  minutes,
  className = "",
}: {
  minutes: number[];
  className?: string;
}) {
  return (
    <div className={`rounded-lg border border-border bg-surface-alt/60 px-4 py-3 ${className}`}>
      <p className="text-xs font-semibold uppercase tracking-wide text-text-dim">Reminders (set for this type)</p>
      <p className="mt-1.5 text-sm font-medium text-text">{formatReminderMinutesList(minutes)}</p>
      <p className="mt-2 text-xs leading-relaxed text-text-muted">
        These offsets cannot be changed for this event type. Google Calendar applies up to five pop-up reminders,
        each at most four weeks before the event; longer offsets remain on the deadline in DocketFlow.
      </p>
    </div>
  );
}
