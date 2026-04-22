/** 5-minute grid for scheduling UI (avoids native datetime-local minute wheels). */
export const FIVE_MINUTE_STEP = 5;

export const FIVE_MINUTE_TIMES: string[] = (() => {
  const out: string[] = [];
  for (let h = 0; h < 24; h++) {
    for (let m = 0; m < 60; m += FIVE_MINUTE_STEP) {
      out.push(`${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`);
    }
  }
  return out;
})();

/** Round "HH:mm" to nearest 5 minutes (for loading existing ISO into the grid). */
export function snapTimeToFiveMinutes(hhmm: string): string {
  const [h, m] = hhmm.split(":").map((x) => parseInt(x, 10));
  if (Number.isNaN(h) || Number.isNaN(m)) return "09:00";
  const total = Math.max(0, h * 60 + m);
  let snapped = Math.round(total / FIVE_MINUTE_STEP) * FIVE_MINUTE_STEP;
  if (snapped >= 24 * 60) snapped = 24 * 60 - FIVE_MINUTE_STEP;
  const nh = Math.floor(snapped / 60);
  const nm = snapped % 60;
  return `${String(nh).padStart(2, "0")}:${String(nm).padStart(2, "0")}`;
}

/** Local calendar date + time → UTC ISO (same behavior as previous `new Date(datetime-local value)`). */
export function localDateTimePartsToIso(dateYmd: string, timeHhmm: string): string {
  const [y, mo, da] = dateYmd.split("-").map((x) => parseInt(x, 10));
  const [h, mi] = timeHhmm.split(":").map((x) => parseInt(x, 10));
  const d = new Date(y, mo - 1, da, h, mi, 0, 0);
  return d.toISOString();
}

export function isoToLocalDateTimeParts(
  iso: string | null | undefined
): { date: string; time: string } {
  if (!iso) return { date: "", time: "" };
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return { date: "", time: "" };
  const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return { date, time: snapTimeToFiveMinutes(`${hh}:${mm}`) };
}

/** Next local 5-minute boundary (rolls to tomorrow if past 23:55) for sensible defaults. */
export function defaultLocalStartParts(): { date: string; time: string } {
  const d = new Date();
  d.setSeconds(0, 0);
  d.setMilliseconds(0);
  let total = d.getHours() * 60 + d.getMinutes();
  total = Math.ceil(total / FIVE_MINUTE_STEP) * FIVE_MINUTE_STEP;
  if (total >= 24 * 60) {
    d.setDate(d.getDate() + 1);
    total = 0;
  }
  d.setHours(Math.floor(total / 60), total % 60, 0, 0);
  const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const time = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  return { date, time };
}

export function formatTimeOptionLabel(hhmm: string): string {
  const [h, m] = hhmm.split(":").map((x) => parseInt(x, 10));
  if (Number.isNaN(h) || Number.isNaN(m)) return hhmm;
  const d = new Date(2000, 0, 1, h, m, 0, 0);
  return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

/** Same calendar day — is end strictly after start? */
export function isEndTimeAfterStartTime(startHhmm: string, endHhmm: string): boolean {
  const [sh, sm] = startHhmm.split(":").map((x) => parseInt(x, 10));
  const [eh, em] = endHhmm.split(":").map((x) => parseInt(x, 10));
  if ([sh, sm, eh, em].some((n) => Number.isNaN(n))) return false;
  return eh * 60 + em > sh * 60 + sm;
}
