/** ISO `YYYY-MM-DD` ↔ US `MM/DD/YYYY` for typable date fields. */

const MIN_YEAR = 1800;
const MAX_YEAR = 2100;

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

/**
 * Restrict typed input to a valid partial or complete `mm/dd/yyyy` mask.
 * Non-digits are stripped; digit sequences that cannot form a valid date are truncated.
 */
export function sanitizeDisplayDateInput(raw: string): string {
  const digits = raw.replace(/\D/g, "").slice(0, 8);
  if (!digits) return "";

  let i = 0;
  let out = "";

  const m0 = digits[i]!;
  if (m0 > "1") {
    out = `0${m0}`;
    i = 1;
  } else if (i + 1 < digits.length) {
    const m1 = digits[i + 1]!;
    const monthNum = Number.parseInt(`${m0}${m1}`, 10);
    if (monthNum < 1 || monthNum > 12) return m0 === "0" ? "0" : m0;
    out = `${m0}${m1}`;
    i += 2;
  } else {
    return m0 === "0" ? "0" : m0;
  }

  if (i >= digits.length) return out;

  const monthNum = Number.parseInt(out, 10);
  const maxDay = maxDayInMonth(monthNum);

  out += "/";
  const d0 = digits[i]!;
  if (d0 > "3") {
    const dayNum = Number.parseInt(`0${d0}`, 10);
    if (dayNum < 1 || dayNum > maxDay) return out.slice(0, -1);
    out += `0${d0}`;
    i += 1;
  } else if (i + 1 < digits.length) {
    const d1 = digits[i + 1]!;
    const dayNum = Number.parseInt(`${d0}${d1}`, 10);
    if (dayNum < 1 || dayNum > maxDay) return `${out}${d0}`;
    out += `${d0}${d1}`;
    i += 2;
  } else {
    if (d0 === "0") return `${out}0`;
    return `${out}${d0}`;
  }

  if (i >= digits.length) return out;

  out += "/";
  const yearDigits = digits.slice(i, i + 4);
  if (yearDigits.length < 4) return out + yearDigits;

  for (let len = 4; len >= 1; len--) {
    const partialYear = yearDigits.slice(0, len);
    if (len < 4) return out + partialYear;
    const year = Number.parseInt(partialYear, 10);
    if (year < MIN_YEAR || year > MAX_YEAR) return out + partialYear.slice(0, 3);
    const [mm, dd] = out.split("/");
    const iso = `${partialYear}-${mm!.padStart(2, "0")}-${dd!.padStart(2, "0")}`;
    if (isValidIsoDate(iso)) return out + partialYear;
    return out + partialYear.slice(0, 3);
  }

  return out;
}

function maxDayInMonth(month: number): number {
  if (month === 2) return 29;
  if (month === 4 || month === 6 || month === 9 || month === 11) return 30;
  return 31;
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
