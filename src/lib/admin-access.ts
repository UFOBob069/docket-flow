/** Firm admin tools: Missing sync, Closed invites, Backfill CSV. */
export const FIRM_ADMIN_EMAIL = "david@ramosjames.com";

export function canAccessFirmAdminTools(email: string | null | undefined): boolean {
  return email?.trim().toLowerCase() === FIRM_ADMIN_EMAIL;
}

/** Paths restricted to {@link FIRM_ADMIN_EMAIL}. */
export const FIRM_ADMIN_PATH_PREFIXES = [
  "/calendar/missing-sync",
  "/calendar/closed-invites",
  "/backfill",
] as const;

export function isFirmAdminPath(pathname: string): boolean {
  const path = pathname.trim();
  return FIRM_ADMIN_PATH_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}
