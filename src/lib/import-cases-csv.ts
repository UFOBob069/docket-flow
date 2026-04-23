import type { Contact } from "./types";

export type ParsedCaseCsvRow = {
  caseNumber: string;
  clientName: string;
  /** Empty unless an optional date_of_incident column was present and valid. */
  dateOfIncident: string;
  attorneyId: string;
  paralegalId: string;
};

/** Normalize header cell to a canonical key. */
function headerKey(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/#/g, "number")
    .replace(/[^a-z0-9_]/g, "");
}

const HEADER_ALIASES: Record<string, keyof CsvColumnMap> = {
  case_number: "caseNumber",
  casenumber: "caseNumber",
  case_no: "caseNumber",
  case: "caseNumber",
  client_name: "clientName",
  client: "clientName",
  clientname: "clientName",
  date_of_incident: "dateOfIncident",
  doi: "dateOfIncident",
  dateofincident: "dateOfIncident",
  incident_date: "dateOfIncident",
  attorney_email: "attorneyEmail",
  attorney: "attorneyEmail",
  attorneyemail: "attorneyEmail",
  paralegal_email: "paralegalEmail",
  paralegal: "paralegalEmail",
  paralegalemail: "paralegalEmail",
};

type CsvColumnMap = {
  caseNumber: number;
  clientName: number;
  dateOfIncident?: number;
  attorneyEmail: number;
  paralegalEmail: number;
};

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

function normalizeIncidentDate(s: string): string | null {
  const t = s.trim();
  if (!t) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  const m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) {
    const mm = m[1]!.padStart(2, "0");
    const dd = m[2]!.padStart(2, "0");
    const yyyy = m[3]!;
    return `${yyyy}-${mm}-${dd}`;
  }
  return null;
}

function resolveContactId(
  value: string,
  role: "attorney" | "paralegal",
  contacts: Contact[]
): { id: string } | { error: string } {
  const v = value.trim();
  if (!v) return { error: "empty" };
  const pool = contacts.filter((c) => c.role === role);
  const lower = v.toLowerCase();
  if (v.includes("@")) {
    const c = pool.find((x) => x.email.trim().toLowerCase() === lower);
    if (!c) return { error: `No ${role} with email ${v}` };
    return { id: c.id };
  }
  const byName = pool.find((x) => x.name.trim().toLowerCase() === lower);
  if (byName) return { id: byName.id };
  const partial = pool.filter((x) => x.name.toLowerCase().includes(lower) || lower.includes(x.name.toLowerCase()));
  if (partial.length === 1) return { id: partial[0]!.id };
  if (partial.length > 1) {
    return { error: `Multiple ${role}s match "${v}" — use email` };
  }
  return { error: `No ${role} match for "${v}"` };
}

/**
 * Parse a CSV for step 1 of ICS import. Required columns (headers flexible):
 * case number, client name, attorney (email or name), paralegal (email or name).
 * Optional: date_of_incident (YYYY-MM-DD or M/D/YYYY) if present.
 */
export function parseCasesImportCsv(
  text: string,
  contacts: Contact[]
): { rows: ParsedCaseCsvRow[]; errors: string[] } {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) {
    return { rows: [], errors: ["CSV needs a header row and at least one data row."] };
  }
  const headerCells = parseCsvLine(lines[0]!);
  const colMap: Partial<CsvColumnMap> = {};
  headerCells.forEach((h, idx) => {
    const canon = HEADER_ALIASES[headerKey(h)];
    if (canon) {
      colMap[canon] = idx;
    }
  });
  const required: (keyof CsvColumnMap)[] = ["caseNumber", "clientName", "attorneyEmail", "paralegalEmail"];
  const missing = required.filter((k) => colMap[k] === undefined);
  if (missing.length) {
    return {
      rows: [],
      errors: [
        `Missing column(s): ${missing.join(", ")}. Required: case_number, client_name, attorney_email, paralegal_email (or attorney / paralegal with name or email). Optional: date_of_incident.`,
      ],
    };
  }
  const map = colMap as CsvColumnMap;
  const rows: ParsedCaseCsvRow[] = [];
  const errors: string[] = [];

  for (let i = 1; i < lines.length; i++) {
    const cells = parseCsvLine(lines[i]!);
    const lineNo = i + 1;
    const caseNumber = (cells[map.caseNumber] ?? "").trim();
    const clientName = (cells[map.clientName] ?? "").trim();
    const doiRaw =
      map.dateOfIncident !== undefined ? (cells[map.dateOfIncident] ?? "").trim() : "";
    const attRaw = (cells[map.attorneyEmail] ?? "").trim();
    const parRaw = (cells[map.paralegalEmail] ?? "").trim();

    if (!caseNumber && !clientName && !doiRaw && !attRaw && !parRaw) continue;

    const rowErr: string[] = [];
    if (!caseNumber) rowErr.push(`Row ${lineNo}: case number is required.`);
    if (!clientName) rowErr.push(`Row ${lineNo}: client name is required.`);
    let dateOfIncident = "";
    if (doiRaw) {
      const parsed = normalizeIncidentDate(doiRaw);
      if (!parsed) rowErr.push(`Row ${lineNo}: date_of_incident must be YYYY-MM-DD or M/D/YYYY.`);
      else dateOfIncident = parsed;
    }

    const att = resolveContactId(attRaw, "attorney", contacts);
    const par = resolveContactId(parRaw, "paralegal", contacts);
    if ("error" in att) {
      rowErr.push(`Row ${lineNo}: attorney — ${att.error === "empty" ? "required" : att.error}.`);
    }
    if ("error" in par) {
      rowErr.push(`Row ${lineNo}: paralegal — ${par.error === "empty" ? "required" : par.error}.`);
    }

    if (rowErr.length) {
      errors.push(...rowErr);
      continue;
    }

    rows.push({
      caseNumber,
      clientName,
      dateOfIncident,
      attorneyId: (att as { id: string }).id,
      paralegalId: (par as { id: string }).id,
    });
  }

  return { rows, errors };
}

export const CASE_IMPORT_CSV_TEMPLATE = `case_number,client_name,attorney_email,paralegal_email
12345-678,Jane Doe,lead@ramosjames.com,paralegal@ramosjames.com`;
