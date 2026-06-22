import type { PreferredLanguage } from "./preferred-languages";
import { normalizePreferredLanguageInput } from "./preferred-languages";
import { EVENT_KIND_LABELS } from "./one-off-events";
import type { EventKind } from "./types";

export type ParsedSolBackfillRow = {
  caseNumber: string;
  solDate: string;
  title: string;
  description: string;
  eventKind: EventKind;
};

export type ParsedOtherBackfillRow = {
  caseNumber: string;
  eventDate: string;
  title: string;
  description: string;
  eventKind: EventKind;
  startTime: string;
  endTime: string;
};

export type ParsedPreferredLanguageBackfillRow = {
  caseNumber: string;
  preferredLanguage: PreferredLanguage;
};

function headerKey(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/#/g, "number")
    .replace(/[^a-z0-9_]/g, "");
}

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (c === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (!inQuotes && c === ",") {
      out.push(cur.trim());
      cur = "";
      continue;
    }
    cur += c;
  }
  out.push(cur.trim());
  return out;
}

function normalizeYmd(s: string): string | null {
  const t = s.trim();
  if (!t) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  const m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  return `${m[3]}-${m[1]!.padStart(2, "0")}-${m[2]!.padStart(2, "0")}`;
}

function normalizeHm(s: string): string | null {
  const t = s.trim();
  if (!t) return "";
  const strict = t.match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  if (strict) return t;
  const loose = t.match(/^(\d{1,2}):([0-5]\d)$/);
  if (!loose) return null;
  const hh = Number.parseInt(loose[1]!, 10);
  if (hh < 0 || hh > 23) return null;
  return `${String(hh).padStart(2, "0")}:${loose[2]}`;
}

function kindLookupMap(): Map<string, EventKind> {
  const map = new Map<string, EventKind>();
  for (const [kind, label] of Object.entries(EVENT_KIND_LABELS)) {
    const k = kind as EventKind;
    map.set(kind.toLowerCase(), k);
    map.set(label.trim().toLowerCase(), k);
    map.set(label.trim().toLowerCase().replace(/[^a-z0-9]+/g, ""), k);
  }
  return map;
}

const KIND_MAP = kindLookupMap();

function parseEventKind(raw: string, fallback: EventKind): EventKind {
  const t = raw.trim();
  if (!t) return fallback;
  const direct = KIND_MAP.get(t.toLowerCase());
  if (direct) return direct;
  const compact = KIND_MAP.get(t.toLowerCase().replace(/[^a-z0-9]+/g, ""));
  return compact ?? fallback;
}

export function parseSolBackfillCsv(text: string): {
  rows: ParsedSolBackfillRow[];
  errors: string[];
} {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return { rows: [], errors: ["CSV needs a header row and at least one data row."] };
  const header = parseCsvLine(lines[0]!).map(headerKey);
  const idxCase = header.findIndex((h) => ["case_number", "casenumber", "case_no", "case"].includes(h));
  const idxDate = header.findIndex((h) => ["sol_date", "date", "event_date", "statute_of_limitations"].includes(h));
  const idxTitle = header.findIndex((h) => ["title", "event_title", "name"].includes(h));
  const idxDesc = header.findIndex((h) => ["description", "notes", "note"].includes(h));
  const idxKind = header.findIndex((h) => ["event_kind", "eventkind", "type", "kind"].includes(h));
  if (idxCase < 0 || idxDate < 0) {
    return {
      rows: [],
      errors: ["Missing column(s). Required: case_number and sol_date (or date/event_date)."],
    };
  }
  const rows: ParsedSolBackfillRow[] = [];
  const errors: string[] = [];
  for (let i = 1; i < lines.length; i++) {
    const lineNo = i + 1;
    const cells = parseCsvLine(lines[i]!);
    const caseNumber = (cells[idxCase] ?? "").trim();
    const dateRaw = (cells[idxDate] ?? "").trim();
    const title = (idxTitle >= 0 ? cells[idxTitle] : "")?.trim() ?? "";
    const description = (idxDesc >= 0 ? cells[idxDesc] : "")?.trim() ?? "";
    const kindRaw = (idxKind >= 0 ? cells[idxKind] : "")?.trim() ?? "";
    if (!caseNumber && !dateRaw && !title && !description && !kindRaw) continue;
    const rowErr: string[] = [];
    if (!caseNumber) rowErr.push(`Row ${lineNo}: case number is required.`);
    const solDate = normalizeYmd(dateRaw);
    if (!solDate) rowErr.push(`Row ${lineNo}: sol_date must be YYYY-MM-DD or M/D/YYYY.`);
    const eventKind = parseEventKind(kindRaw, "milestone_statute_of_limitations");
    if (rowErr.length) {
      errors.push(...rowErr);
      continue;
    }
    rows.push({
      caseNumber,
      solDate: solDate!,
      title: title || "Statute of Limitations",
      description,
      eventKind,
    });
  }
  return { rows, errors };
}

export function parseOtherEventsBackfillCsv(text: string): {
  rows: ParsedOtherBackfillRow[];
  errors: string[];
} {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return { rows: [], errors: ["CSV needs a header row and at least one data row."] };
  const header = parseCsvLine(lines[0]!).map(headerKey);
  const idxCase = header.findIndex((h) => ["case_number", "casenumber", "case_no", "case"].includes(h));
  const idxDate = header.findIndex((h) => ["event_date", "date", "deadline_date"].includes(h));
  const idxTitle = header.findIndex((h) => ["title", "event_title", "name"].includes(h));
  const idxDesc = header.findIndex((h) => ["description", "notes", "note"].includes(h));
  const idxKind = header.findIndex((h) => ["event_kind", "eventkind", "type", "kind"].includes(h));
  const idxStart = header.findIndex((h) => ["start_time", "start", "time_start"].includes(h));
  const idxEnd = header.findIndex((h) => ["end_time", "end", "time_end"].includes(h));
  if (idxCase < 0 || idxDate < 0) {
    return {
      rows: [],
      errors: ["Missing column(s). Required: case_number and event_date (or date/deadline_date)."],
    };
  }
  const rows: ParsedOtherBackfillRow[] = [];
  const errors: string[] = [];
  for (let i = 1; i < lines.length; i++) {
    const lineNo = i + 1;
    const cells = parseCsvLine(lines[i]!);
    const caseNumber = (cells[idxCase] ?? "").trim();
    const dateRaw = (cells[idxDate] ?? "").trim();
    const title = (idxTitle >= 0 ? cells[idxTitle] : "")?.trim() ?? "";
    const description = (idxDesc >= 0 ? cells[idxDesc] : "")?.trim() ?? "";
    const kindRaw = (idxKind >= 0 ? cells[idxKind] : "")?.trim() ?? "";
    const startRaw = (idxStart >= 0 ? cells[idxStart] : "")?.trim() ?? "";
    const endRaw = (idxEnd >= 0 ? cells[idxEnd] : "")?.trim() ?? "";
    if (!caseNumber && !dateRaw && !title && !description && !kindRaw && !startRaw && !endRaw) continue;

    const rowErr: string[] = [];
    if (!caseNumber) rowErr.push(`Row ${lineNo}: case number is required.`);
    const eventDate = normalizeYmd(dateRaw);
    if (!eventDate) rowErr.push(`Row ${lineNo}: event_date must be YYYY-MM-DD or M/D/YYYY.`);
    const startTime = normalizeHm(startRaw);
    const endTime = normalizeHm(endRaw);
    if (startTime === null) rowErr.push(`Row ${lineNo}: start_time must be HH:mm (24-hour).`);
    if (endTime === null) rowErr.push(`Row ${lineNo}: end_time must be HH:mm (24-hour).`);
    if (startTime && endTime && startTime >= endTime) {
      rowErr.push(`Row ${lineNo}: end_time must be after start_time.`);
    }
    const eventKind = parseEventKind(kindRaw, "other_event");

    if (rowErr.length) {
      errors.push(...rowErr);
      continue;
    }
    rows.push({
      caseNumber,
      eventDate: eventDate!,
      title: title || "Backfilled event",
      description,
      eventKind,
      startTime: startTime ?? "",
      endTime: endTime ?? "",
    });
  }
  return { rows, errors };
}

export function parsePreferredLanguageBackfillCsv(text: string): {
  rows: ParsedPreferredLanguageBackfillRow[];
  errors: string[];
} {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return { rows: [], errors: ["CSV needs a header row and at least one data row."] };
  const header = parseCsvLine(lines[0]!).map(headerKey);
  const idxCase = header.findIndex((h) => ["case_number", "casenumber", "case_no", "case"].includes(h));
  const idxLang = header.findIndex((h) =>
    ["preferred_language", "preferredlanguage", "language", "client_language", "clientlanguage"].includes(h)
  );
  if (idxCase < 0 || idxLang < 0) {
    return {
      rows: [],
      errors: ["Missing column(s). Required: case_number and preferred_language (or language)."],
    };
  }
  const rows: ParsedPreferredLanguageBackfillRow[] = [];
  const errors: string[] = [];
  for (let i = 1; i < lines.length; i++) {
    const lineNo = i + 1;
    const cells = parseCsvLine(lines[i]!);
    const caseNumber = (cells[idxCase] ?? "").trim();
    const langRaw = (cells[idxLang] ?? "").trim();
    if (!caseNumber && !langRaw) continue;
    const rowErr: string[] = [];
    if (!caseNumber) rowErr.push(`Row ${lineNo}: case number is required.`);
    const preferredLanguage = normalizePreferredLanguageInput(langRaw);
    if (!preferredLanguage) {
      rowErr.push(`Row ${lineNo}: preferred_language must be English or Spanish.`);
    }
    if (rowErr.length) {
      errors.push(...rowErr);
      continue;
    }
    rows.push({ caseNumber, preferredLanguage: preferredLanguage! });
  }
  return { rows, errors };
}

export const SOL_BACKFILL_CSV_TEMPLATE = `case_number,sol_date,title,description,event_kind
1025,2027-05-01,Statute of Limitations,Backfilled SOL,milestone_statute_of_limitations`;

export const OTHER_EVENTS_BACKFILL_CSV_TEMPLATE = `case_number,event_date,title,event_kind,description,start_time,end_time
1025,2026-09-15,Discovery completion,discovery_completion_deadline,Backfilled from legacy sheet,,
1025,2026-10-03,Client call,client_call,Backfilled legacy appointment,14:00,15:00`;

export const PREFERRED_LANGUAGE_BACKFILL_CSV_TEMPLATE = `case_number,preferred_language
1025,English
2040,Spanish`;
