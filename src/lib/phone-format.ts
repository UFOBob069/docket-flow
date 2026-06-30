/** Normalize US phone input to E.164 (+1XXXXXXXXXX). Returns null if invalid. */
export function normalizeUsPhoneToE164(input: string): string | null {
  const digits = input.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return null;
}

export function isValidUsPhoneInput(input: string): boolean {
  return normalizeUsPhoneToE164(input) !== null;
}

/** Format for display while typing: (XXX) XXX-XXXX */
export function formatUsPhoneDisplay(input: string): string {
  const digits = input.replace(/\D/g, "").slice(0, 11);
  if (!digits) return "";
  const d = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  if (d.length <= 3) return d.length ? `(${d}` : "";
  if (d.length <= 6) return `(${d.slice(0, 3)}) ${d.slice(3)}`;
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6, 10)}`;
}
