export const PREFERRED_LANGUAGE_OPTIONS = ["English", "Spanish"] as const;

export type PreferredLanguage = (typeof PREFERRED_LANGUAGE_OPTIONS)[number];

export function isPreferredLanguage(value: string): value is PreferredLanguage {
  return (PREFERRED_LANGUAGE_OPTIONS as readonly string[]).includes(value);
}

/** Normalize CSV / free-text input to a stored preferred language value. */
export function normalizePreferredLanguageInput(raw: string): PreferredLanguage | null {
  const t = raw.trim();
  if (!t) return null;
  if (isPreferredLanguage(t)) return t;
  const lower = t.toLowerCase();
  if (lower === "en" || lower === "english") return "English";
  if (lower === "es" || lower === "spanish" || lower === "espanol" || lower === "español") return "Spanish";
  return null;
}
