"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameMonth,
  parseISO,
  startOfMonth,
  startOfWeek,
} from "date-fns";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

export type MonthlyCalendarEventChip = {
  id: string;
  date: string;
  title: string;
  href?: string;
  onOpen?: () => void;
  subtitle?: string;
  dimmed?: boolean;
  /** Shown with strikethrough (e.g. marked complete). */
  completed?: boolean;
  selectable?: boolean;
  selected?: boolean;
  onToggleSelect?: () => void;
};

function monthStartDate(yyyyMm: string): Date {
  const d = parseISO(`${yyyyMm}-01`);
  if (Number.isNaN(d.getTime())) return startOfMonth(new Date());
  return d;
}

function chipsByDate(chips: MonthlyCalendarEventChip[]): Map<string, MonthlyCalendarEventChip[]> {
  const m = new Map<string, MonthlyCalendarEventChip[]>();
  for (const c of chips) {
    const list = m.get(c.date) ?? [];
    list.push(c);
    m.set(c.date, list);
  }
  for (const [, list] of m) {
    list.sort((a, b) => a.title.localeCompare(b.title));
  }
  return m;
}

export function MonthlyEventCalendar({
  month,
  chips,
  onMonthChange,
}: {
  month: string;
  chips: MonthlyCalendarEventChip[];
  onMonthChange: (yyyyMm: string) => void;
}) {
  const anchor = monthStartDate(month);
  const monthEnd = endOfMonth(anchor);
  const gridStart = startOfWeek(anchor, { weekStartsOn: 0 });
  const gridEnd = endOfWeek(monthEnd, { weekStartsOn: 0 });
  const days = eachDayOfInterval({ start: gridStart, end: gridEnd });
  const byDate = chipsByDate(chips);

  const yearPart = month.slice(0, 4);
  const monthPart = month.slice(5, 7);
  const currentY = new Date().getFullYear();
  const yearOptions: number[] = [];
  for (let y = currentY - 25; y <= currentY + 10; y++) yearOptions.push(y);

  return (
    <div className="rounded-xl border border-border bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <ButtonMonthNav
            label="Previous month"
            onClick={() => onMonthChange(format(addMonths(anchor, -1), "yyyy-MM"))}
          >
            ‹
          </ButtonMonthNav>
          <select
            className="rounded-lg border border-border bg-surface-alt px-2 py-1.5 text-sm font-medium text-text focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/30"
            value={yearPart}
            aria-label="Year"
            onChange={(e) => onMonthChange(`${e.target.value}-${monthPart}`)}
          >
            {yearOptions.map((y) => (
              <option key={y} value={String(y)}>
                {y}
              </option>
            ))}
          </select>
          <select
            className="min-w-[8.5rem] rounded-lg border border-border bg-surface-alt px-2 py-1.5 text-sm font-medium text-text focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/30"
            value={monthPart}
            aria-label="Month"
            onChange={(e) => onMonthChange(`${yearPart}-${e.target.value}`)}
          >
            {Array.from({ length: 12 }, (_, i) => {
              const mm = String(i + 1).padStart(2, "0");
              return (
                <option key={mm} value={mm}>
                  {format(new Date(2000, i, 1), "MMMM")}
                </option>
              );
            })}
          </select>
          <ButtonMonthNav
            label="Next month"
            onClick={() => onMonthChange(format(addMonths(anchor, 1), "yyyy-MM"))}
          >
            ›
          </ButtonMonthNav>
        </div>
        <p className="text-sm font-semibold text-text">{format(anchor, "MMMM yyyy")}</p>
      </div>

      <div className="grid grid-cols-7 gap-px bg-border">
        {WEEKDAYS.map((d) => (
          <div
            key={d}
            className="bg-surface-alt px-1 py-2 text-center text-[11px] font-semibold uppercase tracking-wide text-text-dim"
          >
            {d}
          </div>
        ))}
        {days.map((day) => {
          const iso = format(day, "yyyy-MM-dd");
          const inMonth = isSameMonth(day, anchor);
          const dayChips = byDate.get(iso) ?? [];
          return (
            <div
              key={iso}
              className={`min-h-[100px] bg-white p-1 sm:min-h-[120px] sm:p-1.5 ${inMonth ? "" : "bg-surface-alt/70"}`}
            >
              <div
                className={`mb-1 text-right text-xs font-medium tabular-nums ${
                  inMonth ? "text-text" : "text-text-dim"
                }`}
              >
                {format(day, "d")}
              </div>
              <ul className="space-y-1">
                {dayChips.map((ch) => (
                  <li key={ch.id}>
                    {ch.selectable && ch.onToggleSelect ? (
                      <div className="flex items-start gap-1 rounded border border-transparent px-0.5 py-0.5 hover:bg-surface-alt">
                        <input
                          type="checkbox"
                          checked={ch.selected}
                          onChange={() => ch.onToggleSelect?.()}
                          className="mt-0.5 h-3.5 w-3.5 shrink-0 rounded border-border text-primary"
                          aria-label={`Select ${ch.title}`}
                        />
                        {ch.onOpen ? (
                          <button
                            type="button"
                            onClick={() => ch.onOpen?.()}
                            className={`min-w-0 flex-1 rounded px-0.5 text-left hover:bg-primary-light/40 ${
                              ch.dimmed ? "opacity-60" : ""
                            }`}
                          >
                            <EventChipBody chip={ch} />
                          </button>
                        ) : (
                          <EventChipBody chip={ch} />
                        )}
                      </div>
                    ) : ch.href ? (
                      <Link
                        href={ch.href}
                        className={`block rounded border border-transparent px-0.5 py-0.5 text-left hover:bg-surface-alt ${
                          ch.dimmed ? "opacity-60" : ""
                        }`}
                      >
                        <EventChipBody chip={ch} />
                      </Link>
                    ) : (
                      <button
                        type="button"
                        onClick={ch.onOpen}
                        className={`w-full rounded border border-transparent px-0.5 py-0.5 text-left hover:bg-surface-alt ${
                          ch.dimmed ? "opacity-60" : ""
                        }`}
                      >
                        <EventChipBody chip={ch} />
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function EventChipBody({ chip }: { chip: MonthlyCalendarEventChip }) {
  return (
    <span className="min-w-0 flex-1">
      <span
        className={`line-clamp-2 text-[10px] font-medium leading-tight sm:text-xs ${
          chip.completed ? "text-text-muted line-through" : "text-text"
        }`}
      >
        {chip.title}
        {chip.completed && (
          <span className="ml-0.5 text-[9px] font-semibold uppercase tracking-wide text-success">
            {" "}
            Done
          </span>
        )}
      </span>
      {chip.subtitle && (
        <span className="mt-0.5 line-clamp-1 block text-[9px] text-text-dim sm:text-[10px]">{chip.subtitle}</span>
      )}
    </span>
  );
}

function ButtonMonthNav({
  children,
  label,
  onClick,
}: {
  children: ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-white text-lg font-semibold text-text shadow-sm transition hover:bg-surface-alt"
    >
      {children}
    </button>
  );
}
