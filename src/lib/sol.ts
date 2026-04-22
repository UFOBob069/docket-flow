/** Statute of limitations: default 2 years from incident (Texas PI-style; adjust if needed). */
export function statuteLimitDateIso(incidentDateIso: string, years = 2): string {
  const d = new Date(`${incidentDateIso.slice(0, 10)}T12:00:00`);
  d.setFullYear(d.getFullYear() + years);
  return d.toISOString().slice(0, 10);
}

/** If SOL falls on Saturday or Sunday, use the preceding Friday (firm calendar convention). */
export function adjustSolWeekendToFriday(isoDate: string): string {
  const d = new Date(`${isoDate.slice(0, 10)}T12:00:00`);
  const day = d.getDay();
  if (day === 6) d.setDate(d.getDate() - 1);
  else if (day === 0) d.setDate(d.getDate() - 2);
  return d.toISOString().slice(0, 10);
}

/** Two-year SOL from incident, then weekend → Friday. */
export function statuteLimitDateIsoForCalendar(incidentDateIso: string, years = 2): string {
  return adjustSolWeekendToFriday(statuteLimitDateIso(incidentDateIso, years));
}
