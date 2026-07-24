/**
 * Server-to-server auth for Case Tracker → DocketFlow internal APIs.
 * Prefer DOCKETFLOW_INTERNAL_API_SECRET; fall back to CRON_SECRET (same value in both apps).
 */
export function authorizeInternalApiBearer(authorizationHeader: string | null): boolean {
  const expected =
    process.env.DOCKETFLOW_INTERNAL_API_SECRET?.trim() || process.env.CRON_SECRET?.trim();
  if (!expected) return false;
  const header = authorizationHeader?.trim() ?? "";
  if (!header.startsWith("Bearer ")) return false;
  const token = header.slice("Bearer ".length).trim();
  return token.length > 0 && token === expected;
}
