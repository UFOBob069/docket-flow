/** ISO `YYYY-MM-DD` ↔ US `MM/DD/YYYY` for typable date fields. */

export function isoToDisplayDate(iso: string): string {
  const t = iso.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) return "";
  const [y, m, d] = t.split("-");
  return `${m}/${d}/${y}`;
}

/** Parse `MM/DD/YYYY` or ISO date to `YYYY-MM-DD`; empty string if blank; null if invalid. */
export function parseDisplayDate(input: string): string | null {
  const t = input.trim();
  if (!t) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return isValidIsoDate(t) ? t : null;

  const slash = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!slash) return null;
  const month = slash[1]!.padStart(2, "0");
  const day = slash[2]!.padStart(2, "0");
  const year = slash[3]!;
  const iso = `${year}-${month}-${day}`;
  return isValidIsoDate(iso) ? iso : null;
}

function isValidIsoDate(iso: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false;
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1, d!));
  return (
    dt.getUTCFullYear() === y &&
    dt.getUTCMonth() === m! - 1 &&
    dt.getUTCDate() === d
  );
}
