import type { Case } from "./types";

function normClient(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
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
  const parts = title
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

/**
 * Pick a single active case when the ICS title matches our SOL export pattern.
 * Uses `clientName` on the case; if several match, uses DOL from the title vs `dateOfIncident`.
 */
export function matchCaseForSolIcsTitle(title: string, cases: Case[]): string | null {
  const parsed = parseSolGroupCalendarTitle(title);
  if (!parsed) return null;

  const titleKeys = clientNameMatchKeys(parsed.clientName);
  if (titleKeys.size === 0 || [...titleKeys].every((k) => !k)) return null;

  const exact = cases.filter((c) => {
    const cn = c.clientName ?? "";
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
      const raw = c.clientName ?? "";
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
