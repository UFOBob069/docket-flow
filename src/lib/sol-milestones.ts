import { subDays, subMonths } from "date-fns";
import type { EventKind } from "./types";
import { adjustSolWeekendToFriday } from "./sol";

/** Civil calendar date in local time (America/Chicago-style parsing for YYYY-MM-DD). */
function civilDate(iso: string): Date {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) throw new Error("Invalid date");
  return new Date(y, m - 1, d);
}

function formatYmd(d: Date): string {
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${mo}-${day}`;
}

const DEFAULT_MILESTONE_REMINDERS = [10080, 1440];

export type SolMilestoneCalendarSpec = {
  eventKind: EventKind;
  date: string;
  /** DocketFlow list / edit label when no calendar case name is passed */
  title: string;
  /** Uppercase stem for Google Calendar summary: `{stem} - {case name}` */
  googleSummaryStem: string;
  description: string;
  reminderMinutes: number[];
};

/**
 * Six SOL checkpoints (6 months, 90d, 6w, 4w, 1w, due date). If two offsets fall on the same
 * calendar day, only the earlier-listed milestone is kept so Google matches the UI list order.
 */
export function buildSolMilestoneSpecs(
  solDateIso: string,
  incidentDateIso: string,
  finalReminderMinutes: number[]
): SolMilestoneCalendarSpec[] {
  const solAnchor = adjustSolWeekendToFriday(solDateIso.slice(0, 10));
  const sol = civilDate(solAnchor);
  const phases: { kind: EventKind; label: string; stem: string; date: Date }[] = [
    { kind: "sol_milestone", label: "6 months before due date", stem: "6 MONTHS TO SOL", date: subMonths(sol, 6) },
    { kind: "sol_milestone", label: "90 days before due date", stem: "90 DAYS TO SOL", date: subDays(sol, 90) },
    { kind: "sol_milestone", label: "6 weeks before due date", stem: "6 WEEKS TO SOL", date: subDays(sol, 42) },
    { kind: "sol_milestone", label: "4 weeks before due date", stem: "4 WEEKS TO SOL", date: subDays(sol, 28) },
    { kind: "sol_milestone", label: "1 week before due date", stem: "1 WEEK TO SOL", date: subDays(sol, 7) },
    { kind: "sol", label: "due date", stem: "SOL DUE DATE", date: sol },
  ];

  const seenDates = new Set<string>();
  const out: SolMilestoneCalendarSpec[] = [];

  for (const p of phases) {
    const date = formatYmd(p.date);
    if (seenDates.has(date)) continue;
    seenDates.add(date);

    const description = [
      `SOL due date: ${solAnchor}`,
      `Date of incident: ${incidentDateIso.slice(0, 10)}`,
      p.kind === "sol"
        ? "Final statute-of-limitations deadline (all-day)."
        : `Lead-up milestone: ${p.label}.`,
    ].join("\n");

    out.push({
      eventKind: p.kind,
      date,
      title:
        p.kind === "sol"
          ? "Statute of limitations (2 years)"
          : `SOL — ${p.label}`,
      googleSummaryStem: p.stem,
      description,
      reminderMinutes:
        p.kind === "sol" ? [...finalReminderMinutes] : [...DEFAULT_MILESTONE_REMINDERS],
    });
  }

  return out;
}
