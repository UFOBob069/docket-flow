import type { EventCategory } from "./types";

export interface ReminderOption {
  label: string;
  minutes: number;
}

/** Google Calendar API max is 40 320 min (4 weeks). */
export const MAX_REMINDER_MINUTES = 40320;

export const REMINDER_OPTIONS: ReminderOption[] = [
  { label: "At time of event", minutes: 0 },
  { label: "15 minutes before", minutes: 15 },
  { label: "30 minutes before", minutes: 30 },
  { label: "1 hour before", minutes: 60 },
  { label: "2 hours before", minutes: 120 },
  { label: "1 day before", minutes: 1440 },
  { label: "2 days before", minutes: 2880 },
  { label: "3 days before", minutes: 4320 },
  { label: "1 week before", minutes: 10080 },
  { label: "2 weeks before", minutes: 20160 },
  { label: "4 weeks before", minutes: 40320 },
];

export const DEFAULT_REMINDERS: Record<EventCategory, number[]> = {
  trial:      [40320, 20160, 10080, 1440],  // 4w, 2w, 1w, 1d
  mediation:  [20160, 10080, 1440],          // 2w, 1w, 1d
  experts:    [20160, 10080, 1440],          // 2w, 1w, 1d
  motions:    [20160, 10080, 1440],          // 2w, 1w, 1d
  discovery:  [20160, 10080, 1440],          // 2w, 1w, 1d
  pretrial:   [20160, 10080, 1440],          // 2w, 1w, 1d
  other:      [10080, 1440],                 // 1w, 1d
};

export function labelForMinutes(minutes: number): string {
  const match = REMINDER_OPTIONS.find((o) => o.minutes === minutes);
  if (match) return match.label;
  if (minutes < 60) return `${minutes}m before`;
  if (minutes < 1440) return `${Math.round(minutes / 60)}h before`;
  return `${Math.round(minutes / 1440)}d before`;
}

const DAY = 1440;

/** Human phrase for a single offset (e.g. "2 weeks", "30 days") matching firm scheduling language. */
export function formatMinutesAsSchedulePhrase(m: number): string {
  if (m === 0) return "At time of event";
  const daysExact = m / DAY;
  if (Number.isInteger(daysExact) && daysExact > 0) {
    if (daysExact === 120) return "120 days";
    if (daysExact === 90) return "90 days";
    if (daysExact === 60) return "60 days";
    if (daysExact === 30) return "30 days";
    if (daysExact === 14) return "2 weeks";
    if (daysExact === 7) return "1 week";
    if (daysExact === 3) return "3 days";
    if (daysExact === 2) return "2 days";
    if (daysExact === 1) return "1 day";
    return `${daysExact} days`;
  }
  const weeksExact = m / 10080;
  if (Number.isInteger(weeksExact) && weeksExact > 0 && weeksExact <= 4) {
    return weeksExact === 1 ? "1 week" : `${weeksExact} weeks`;
  }
  return labelForMinutes(m);
}

/** Comma-separated reminder list for read-only UI. */
export function formatReminderMinutesList(minutes: number[]): string {
  if (!minutes.length) return "None";
  return minutes.map(formatMinutesAsSchedulePhrase).join(", ");
}
