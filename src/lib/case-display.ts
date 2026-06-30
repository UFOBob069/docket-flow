import { caseClientName } from "./client-name";
import type { Case } from "./types";

/** Strip non-digits while typing a new case number. */
export function digitsOnlyCaseNumberInput(value: string): string {
  return value.replace(/\D/g, "");
}

export function isValidNumericCaseNumber(value: string): boolean {
  const v = value.trim();
  return v.length > 0 && /^\d+$/.test(v);
}

/** Keys to match `case_slack_channels.case_number` (exact, digits-only, no leading zeros). */
export function caseNumberLookupKeys(
  caseRecord: Pick<{ caseNumber?: string | null; causeNumber?: string | null }, "caseNumber" | "causeNumber">
): string[] {
  const keys = new Set<string>();
  for (const raw of [caseRecord.caseNumber, caseRecord.causeNumber]) {
    const t = raw?.trim();
    if (!t) continue;
    keys.add(t);
    const digits = t.replace(/\D/g, "");
    if (digits) {
      keys.add(digits);
      const n = Number.parseInt(digits, 10);
      if (Number.isFinite(n)) keys.add(String(n));
    }
  }
  return [...keys];
}

/** Display title for lists and headers (supports legacy docs without caseNumber). */
export function caseDisplayName(c: Case): string {
  const num = c.caseNumber?.trim() || c.causeNumber?.trim() || "";
  const client = caseClientName(c);
  if (num && client) return `${client} (${num})`;
  if (client) return client;
  return c.name || "Case";
}
