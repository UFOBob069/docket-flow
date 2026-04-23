import { getRemindersForEventKind } from "./case-event-kinds";
import type { CalendarEvent, EventKind, ExtractedDeadline } from "./types";
import { EVENT_KIND_LABELS, categoryForManualEventKind } from "./one-off-events";
import { v4 as uuidv4 } from "uuid";

const NOISE_PATTERNS =
  /\b(page|pp?\.|line|l\.\s*\d|cross[- ]designation|confer in good faith|meet and confer)\b/i;

function normalizeText(s: string): string {
  return s
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[^\w\s]/g, "")
    .trim();
}

function similar(a: string, b: string): boolean {
  const na = normalizeText(a);
  const nb = normalizeText(b);
  if (!na.length || !nb.length) return false;
  if (na === nb) return true;
  const shorter = na.length < nb.length ? na : nb;
  const longer = na.length >= nb.length ? na : nb;
  return longer.includes(shorter) && shorter.length / longer.length > 0.72;
}

function parseExtractedEventKind(raw: string | undefined): EventKind {
  if (raw && raw in EVENT_KIND_LABELS) return raw as EventKind;
  return "other_event";
}

function parsePriority(raw?: string): CalendarEvent["priority"] | undefined {
  if (!raw) return undefined;
  const p = raw.toLowerCase();
  if (p === "high" || p === "medium" || p === "low") return p;
  return undefined;
}

/** Dedupe: same calendar day + similar title/description */
export function dedupeExtracted(rows: ExtractedDeadline[]): ExtractedDeadline[] {
  const out: ExtractedDeadline[] = [];
  for (const row of rows) {
    const dup = out.find(
      (e) =>
        e.date === row.date &&
        (similar(e.title, row.title) || similar(e.description, row.description))
    );
    if (dup) {
      if (row.description.length > dup.description.length) {
        dup.description = row.description;
      }
      if (row.title.length > dup.title.length) {
        dup.title = row.title;
      }
    } else {
      out.push({ ...row });
    }
  }
  return out;
}

/** Assign same groupId for same-date suggestions */
export function assignGroupSuggestions(
  rows: ExtractedDeadline[]
): { row: ExtractedDeadline; groupId?: string }[] {
  const byDate = new Map<string, ExtractedDeadline[]>();
  for (const row of rows) {
    const list = byDate.get(row.date) ?? [];
    list.push(row);
    byDate.set(row.date, list);
  }
  return rows.map((row) => {
    const list = byDate.get(row.date) ?? [];
    const groupId =
      list.length > 1 ? `grp-${row.date}` : undefined;
    return { row, groupId };
  });
}

export function isNoise(description: string, title: string): {
  noise: boolean;
  reason?: string;
} {
  const text = `${title} ${description}`;
  if (NOISE_PATTERNS.test(text)) {
    return { noise: true, reason: "Low-signal procedural reference" };
  }
  return { noise: false };
}

export function extractedToCalendarEvents(
  caseId: string,
  ownerId: string,
  rows: ExtractedDeadline[]
): CalendarEvent[] {
  const deduped = dedupeExtracted(rows);
  const withGroups = assignGroupSuggestions(deduped);
  const now = Date.now();
  return withGroups.map(({ row, groupId }) => {
    const { noise, reason } = isNoise(row.description, row.title);
    const eventKind = parseExtractedEventKind(row.eventKind);
    const category = categoryForManualEventKind(eventKind);
    return {
      id: uuidv4(),
      caseId,
      ownerId,
      calendarOrigin: "docketflow" as const,
      title: row.title?.trim() || "Deadline",
      date: row.date,
      description: row.description?.trim() ?? "",
      eventKind,
      category,
      priority: parsePriority(row.priority),
      included: !noise,
      completed: false,
      groupSuggested: Boolean(groupId),
      groupId,
      mergeWithSameGroup: false,
      noiseFlag: noise,
      noiseReason: reason,
      remindersMinutes: [...getRemindersForEventKind(eventKind)],
      createdAt: now,
      updatedAt: now,
    };
  });
}
