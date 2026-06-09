import type { Case } from "./types";

/** Strip non-digits while typing a new case number. */
export function digitsOnlyCaseNumberInput(value: string): string {
  return value.replace(/\D/g, "");
}

export function isValidNumericCaseNumber(value: string): boolean {
  const v = value.trim();
  return v.length > 0 && /^\d+$/.test(v);
}

/** Display title for lists and headers (supports legacy docs without caseNumber). */
export function caseDisplayName(c: Case): string {
  const num = c.caseNumber?.trim() || c.causeNumber?.trim() || "";
  if (num && c.clientName) return `${c.clientName} (${num})`;
  if (c.clientName) return c.clientName;
  return c.name || "Case";
}
