import type { Case } from "./types";

/** En dash, em dash, minus sign → ASCII hyphen so SOL titles parse reliably from ICS exports. */
function normalizeCalendarTitleDashes(title: string): string {
  return title.replace(/[\u2013\u2014\u2212]/g, "-");
}

function normClient(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Client string for ICS matching: `clientName` when set; otherwise strip a trailing
 * ` (case #)` suffix from `name` (e.g. `DAVIS MAIGA (1025)` → `DAVIS MAIGA`).
 */
function effectiveClientLabel(c: Case): string {
  const cl = (c.clientName ?? "").trim();
  if (cl) return cl;
  const n = (c.name ?? "").trim();
  if (!n) return "";
  const m = n.match(/^(.+?)\s*\(\s*[^)]+\)\s*$/);
  if (m?.[1]?.trim()) return m[1]!.trim();
  return n;
}

/** Normalized variants for matching (e.g. `Last, First` vs `First Last`). */
function clientNameMatchKeys(name: string): Set<string> {
  const n = name.trim().replace(/\s+/g, " ");
  const keys = new Set<string>();
  keys.add(normClient(n));
  if (n.includes(",")) {
    const parts = n.split(",").map((p) => p.trim()).filter(Boolean);
    if (parts.length >= 2) {
      keys.add(normClient(`${parts.slice(1).join(" ")} ${parts[0]}`));
    }
  }
  return keys;
}

/** Parse `DOL 05-01-24` or `DOL 5/1/2024` as M/D/Y (US) → YYYY-MM-DD. */
function parseDolSegment(segment: string): string | null {
  const rest = segment.replace(/^DOL\s+/i, "").trim();
  const dash = rest.match(/^(\d{1,2})-(\d{1,2})-(\d{2}|\d{4})$/);
  if (dash) {
    const mm = dash[1]!.padStart(2, "0");
    const dd = dash[2]!.padStart(2, "0");
    let y = parseInt(dash[3]!, 10);
    if (y < 100) y += 2000;
    return `${y}-${mm}-${dd}`;
  }
  const slash = rest.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
  if (slash) {
    const mm = slash[1]!.padStart(2, "0");
    const dd = slash[2]!.padStart(2, "0");
    let y = parseInt(slash[3]!, 10);
    if (y < 100) y += 2000;
    return `${y}-${mm}-${dd}`;
  }
  return null;
}

/**
 * Extract client name from firm SOL group-calendar titles, e.g.
 * `1 WEEK TO SOL - DAVIS MAIGA - DOL 05-01-24` → client `DAVIS MAIGA`, optional DOL date.
 * Also handles `… - CLIENT` when the first segment mentions SOL and there is no DOL tail.
 */
export function parseSolGroupCalendarTitle(
  title: string
): { clientName: string; dolYmd: string | null } | null {
  const parts = normalizeCalendarTitleDashes(title.trim())
    .split(/\s+-\s+/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length < 2) return null;

  const last = parts[parts.length - 1]!;
  if (/^DOL\s+/i.test(last)) {
    if (parts.length < 3) return null;
    const clientName = parts[parts.length - 2]!.trim();
    if (!clientName) return null;
    return { clientName, dolYmd: parseDolSegment(last) };
  }

  if (/SOL/i.test(parts[0]!)) {
    const clientName = last.trim();
    if (!clientName) return null;
    return { clientName, dolYmd: null };
  }

  return null;
}

function compactAlnum(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** True if the event title visibly includes this case number (handles extra spaces / hyphen spacing). */
export function titleContainsCaseNumber(title: string, caseNumber: string): boolean {
  const raw = caseNumber.trim();
  if (!raw || raw.length < 3) return false;
  const t = title.toLowerCase();
  const n = raw.toLowerCase();
  if (t.includes(n)) return true;
  const nc = compactAlnum(n);
  if (nc.length < 4) return false;
  return compactAlnum(t).includes(nc);
}

/** True if the normalized client name appears as a substring of the title (same rules as CSV name match). */
export function titleContainsClientName(title: string, clientName: string): boolean {
  const t = normClient(title);
  if (!clientName.trim()) return false;
  for (const k of clientNameMatchKeys(clientName)) {
    if (k.length < 2) continue;
    if (t.includes(k)) return true;
  }
  return false;
}

/** CSV row / “New case” draft pending ICS import. */
export type PendingIcsCaseDraft = {
  draftId: string;
  clientName: string;
  caseNumber: string;
  dateOfIncident: string;
};

/**
 * Map an ICS event title to `existing:<caseId>` or `draft:<draftId>` when unambiguous.
 *
 * Priority: (1) pending draft where **client name + case number** both appear in the title,
 * (2) existing case same, (3) existing case **case number only** unique in title,
 * (4) SOL-style title by **client + DOL** on existing cases only.
 */
export function matchIcsTitleToAssignTo(
  title: string,
  cases: Case[],
  pendingDrafts: PendingIcsCaseDraft[]
): string | null {
  const t = normalizeCalendarTitleDashes(title.trim());
  const parsed = parseSolGroupCalendarTitle(t);

  const pend = pendingDrafts.filter((d) => {
    const num = d.caseNumber.trim();
    const cl = d.clientName.trim();
    return num && cl && titleContainsCaseNumber(t, num) && titleContainsClientName(t, cl);
  });
  if (pend.length === 1) return `draft:${pend[0]!.draftId}`;
  if (pend.length > 1 && parsed?.dolYmd) {
    const narrowed = pend.filter((d) => d.dateOfIncident.trim() === parsed.dolYmd);
    if (narrowed.length === 1) return `draft:${narrowed[0]!.draftId}`;
  }

  const existBoth = cases.filter((c) => {
    const num = c.caseNumber?.trim() || c.causeNumber?.trim() || "";
    const cl = effectiveClientLabel(c);
    return num && cl && titleContainsCaseNumber(t, num) && titleContainsClientName(t, cl);
  });
  if (existBoth.length === 1) return `existing:${existBoth[0]!.id}`;
  if (existBoth.length > 1 && parsed?.dolYmd) {
    const narrowed = existBoth.filter((c) => c.dateOfIncident === parsed.dolYmd);
    if (narrowed.length === 1) return `existing:${narrowed[0]!.id}`;
  }

  const numOnly = cases.filter((c) => {
    const num = c.caseNumber?.trim() || c.causeNumber?.trim() || "";
    return num && titleContainsCaseNumber(t, num);
  });
  if (numOnly.length === 1) return `existing:${numOnly[0]!.id}`;

  const solId = matchCaseForSolIcsTitle(t, cases);
  if (solId) return `existing:${solId}`;

  return null;
}

/**
 * Pick a single active case when the ICS title matches our SOL export pattern.
 * Uses `clientName` on the case; if several match, uses DOL from the title vs `dateOfIncident`.
 */
export function matchCaseForSolIcsTitle(title: string, cases: Case[]): string | null {
  const t = normalizeCalendarTitleDashes(title.trim());
  const parsed = parseSolGroupCalendarTitle(t);
  if (!parsed) return null;

  const titleKeys = clientNameMatchKeys(parsed.clientName);
  if (titleKeys.size === 0 || [...titleKeys].every((k) => !k)) return null;

  const exact = cases.filter((c) => {
    const cn = effectiveClientLabel(c);
    if (!cn.trim()) return false;
    const caseKeys = clientNameMatchKeys(cn);
    for (const tk of titleKeys) {
      for (const ck of caseKeys) {
        if (tk && ck && tk === ck) return true;
      }
    }
    return false;
  });
  let pool = exact;
  if (pool.length === 0) {
    const fuzzy = cases.filter((c) => {
      const raw = effectiveClientLabel(c);
      if (!raw.trim()) return false;
      const cn = normClient(raw);
      for (const tk of titleKeys) {
        if (!tk) continue;
        if (cn.includes(tk) || tk.includes(cn)) return true;
      }
      return false;
    });
    if (fuzzy.length === 1) pool = fuzzy;
    else if (fuzzy.length > 1 && parsed.dolYmd) {
      pool = fuzzy.filter((c) => c.dateOfIncident === parsed.dolYmd);
    } else {
      return null;
    }
  }

  if (pool.length === 1) return pool[0]!.id;

  if (parsed.dolYmd) {
    const byDol = pool.filter((c) => c.dateOfIncident === parsed.dolYmd);
    if (byDol.length === 1) return byDol[0]!.id;
  }

  return null;
}
