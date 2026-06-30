import type { Case } from "./types";

/** Display name for UI: "First Last" (no case number). */
export function formatClientDisplayName(firstName: string, lastName: string): string {
  return `${firstName.trim()} ${lastName.trim()}`.trim();
}

/** Quo last name convention: family name + case number (e.g. "Eagan 9999"). */
export function quoContactLastName(lastName: string, caseNumber: string): string {
  const last = lastName.trim();
  const cn = caseNumber.trim();
  if (!last) return cn;
  if (!cn) return last;
  return `${last} ${cn}`;
}

/** Full Quo contact label: "David Eagan 9999". */
export function quoContactDisplayLabel(
  firstName: string,
  lastName: string,
  caseNumber: string
): string {
  const first = firstName.trim();
  const lastWithCase = quoContactLastName(lastName, caseNumber);
  return [first, lastWithCase].filter(Boolean).join(" ").trim();
}

export function caseClientName(c: Pick<Case, "clientName" | "clientFirstName" | "clientLastName">): string {
  const first = c.clientFirstName?.trim() ?? "";
  const last = c.clientLastName?.trim() ?? "";
  if (first && last) return formatClientDisplayName(first, last);
  return c.clientName?.trim() ?? "";
}

/** Value for `cases.client_name` — prefer first + last when both are present. */
export function resolvedCaseClientName(input: {
  clientName?: string | null;
  clientFirstName?: string | null;
  clientLastName?: string | null;
}): string {
  const first = input.clientFirstName?.trim() ?? "";
  const last = input.clientLastName?.trim() ?? "";
  if (first && last) return formatClientDisplayName(first, last);
  return input.clientName?.trim() ?? "";
}
