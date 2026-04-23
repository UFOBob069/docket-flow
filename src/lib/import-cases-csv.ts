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

type HeaderTarget =
  | { kind: "caseNumber" }
  | { kind: "clientName" }
  | { kind: "dateOfIncident" }
  | { kind: "contact"; role: "attorney" | "paralegal"; nameOnly: boolean };

/** `nameOnly`: column is explicitly a name — match Contacts `name` only, never treat `@` as email. */
const HEADER_TARGETS: Record<string, HeaderTarget> = {
  case_number: { kind: "caseNumber" },
  casenumber: { kind: "caseNumber" },
  case_no: { kind: "caseNumber" },
  case: { kind: "caseNumber" },
  client_name: { kind: "clientName" },
  client: { kind: "clientName" },
  clientname: { kind: "clientName" },
  date_of_incident: { kind: "dateOfIncident" },
  doi: { kind: "dateOfIncident" },
  dateofincident: { kind: "dateOfIncident" },
  incident_date: { kind: "dateOfIncident" },
  attorney_email: { kind: "contact", role: "attorney", nameOnly: false },
  attorney: { kind: "contact", role: "attorney", nameOnly: false },
  attorneyemail: { kind: "contact", role: "attorney", nameOnly: false },
  attorney_name: { kind: "contact", role: "attorney", nameOnly: true },
  attorneyname: { kind: "contact", role: "attorney", nameOnly: true },
  paralegal_email: { kind: "contact", role: "paralegal", nameOnly: false },
  paralegal: { kind: "contact", role: "paralegal", nameOnly: false },
  paralegalemail: { kind: "contact", role: "paralegal", nameOnly: false },
  paralegal_name: { kind: "contact", role: "paralegal", nameOnly: true },
  paralegalname: { kind: "contact", role: "paralegal", nameOnly: true },
};

type ParsedHeaderMap = {
  caseNumber: number;
  clientName: number;
  dateOfIncident?: number;
  attorney: { index: number; nameOnly: boolean };
  paralegal: { index: number; nameOnly: boolean };
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

function normName(s: string): string {
  return s.trim().replace(/\s+/g, " ").toLowerCase();
}

function matchContactByName(
  v: string,
  role: "attorney" | "paralegal",
  contacts: Contact[]
): { id: string } | { error: string } {
  const pool = contacts.filter((c) => c.role === role);
  const vKey = normName(v);
  if (!vKey) return { error: "empty" };

  const byName = pool.find((x) => normName(x.name) === vKey);
  if (byName) return { id: byName.id };

  if (v.includes(",")) {
    const parts = v.split(",").map((p) => p.trim()).filter(Boolean);
    if (parts.length >= 2) {
      const swapped = `${parts.slice(1).join(" ")} ${parts[0]}`.trim();
      const swappedKey = normName(swapped);
      const bySwapped = pool.find((x) => normName(x.name) === swappedKey);
      if (bySwapped) return { id: bySwapped.id };
    }
  }

  const partial = pool.filter((x) => {
    const nk = normName(x.name);
    return nk.includes(vKey) || vKey.includes(nk);
  });
  if (partial.length === 1) return { id: partial[0]!.id };
  if (partial.length > 1) {
    return { error: `Multiple ${role}s match "${v}" — use full name exactly as in Contacts` };
  }
  return { error: `No ${role} named "${v}" in Contacts` };
}

function resolveContactId(
  value: string,
  role: "attorney" | "paralegal",
  contacts: Contact[],
  opts: { nameOnlyColumn: boolean }
): { id: string } | { error: string } {
  const v = value.trim().replace(/\s+/g, " ");
  if (!v) return { error: "empty" };
  const pool = contacts.filter((c) => c.role === role);
  const lower = v.toLowerCase();

  if (opts.nameOnlyColumn) {
    return matchContactByName(v, role, contacts);
  }

  if (v.includes("@")) {
    const c = pool.find((x) => x.email.trim().toLowerCase() === lower);
    if (c) return { id: c.id };
    const byName = matchContactByName(v, role, contacts);
    if ("id" in byName) return byName;
    return {
      error: `No ${role} with email ${v} and no Contacts name match — use a real email or name from Contacts`,
    };
  }

  return matchContactByName(v, role, contacts);
}

function parseHeaders(headerCells: string[]): ParsedHeaderMap | { error: string } {
  const partial: Partial<{
    caseNumber: number;
    clientName: number;
    dateOfIncident: number;
    attorney: { index: number; nameOnly: boolean };
    paralegal: { index: number; nameOnly: boolean };
  }> = {};

  headerCells.forEach((h, idx) => {
    const target = HEADER_TARGETS[headerKey(h)];
    if (!target) return;
    switch (target.kind) {
      case "caseNumber":
        partial.caseNumber = idx;
        break;
      case "clientName":
        partial.clientName = idx;
        break;
      case "dateOfIncident":
        partial.dateOfIncident = idx;
        break;
      case "contact":
        if (target.role === "attorney") {
          partial.attorney = { index: idx, nameOnly: target.nameOnly };
        } else {
          partial.paralegal = { index: idx, nameOnly: target.nameOnly };
        }
        break;
      default:
        break;
    }
  });

  if (
    partial.caseNumber === undefined ||
    partial.clientName === undefined ||
    partial.attorney === undefined ||
    partial.paralegal === undefined
  ) {
    return {
      error:
        "Missing column(s). Required: case_number, client_name, plus attorney and paralegal columns " +
        "(e.g. attorney_name & paralegal_name, or attorney_email & paralegal_email, or attorney / paralegal). " +
        "Optional: date_of_incident.",
    };
  }

  return partial as ParsedHeaderMap;
}

/**
 * Parse a CSV for step 1 of ICS import. Required columns (headers flexible):
 * case number, client name, attorney (email or name), paralegal (email or name).
 * Headers **attorney_name** / **paralegal_name** match Contacts **name** only (not email).
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
  const headerResult = parseHeaders(headerCells);
  if ("error" in headerResult) {
    return { rows: [], errors: [headerResult.error] };
  }
  const map = headerResult;

  const rows: ParsedCaseCsvRow[] = [];
  const errors: string[] = [];

  for (let i = 1; i < lines.length; i++) {
    const cells = parseCsvLine(lines[i]!);
    const lineNo = i + 1;
    const caseNumber = (cells[map.caseNumber] ?? "").trim();
    const clientName = (cells[map.clientName] ?? "").trim();
    const doiRaw =
      map.dateOfIncident !== undefined ? (cells[map.dateOfIncident] ?? "").trim() : "";
    const attRaw = (cells[map.attorney.index] ?? "").trim();
    const parRaw = (cells[map.paralegal.index] ?? "").trim();

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

    const att = resolveContactId(attRaw, "attorney", contacts, {
      nameOnlyColumn: map.attorney.nameOnly,
    });
    const par = resolveContactId(parRaw, "paralegal", contacts, {
      nameOnlyColumn: map.paralegal.nameOnly,
    });
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

export const CASE_IMPORT_CSV_TEMPLATE = `case_number,client_name,attorney_name,paralegal_name
12345-678,Jane Doe,Lead Attorney Name,Paralegal Name`;
