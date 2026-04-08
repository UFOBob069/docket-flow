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
