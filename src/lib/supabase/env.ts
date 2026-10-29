/**
 * Supabase project URL + API keys.
 * Prefer publishable / secret keys; fall back to legacy anon / service_role during migration.
 * @see https://supabase.com/docs/guides/api/api-keys
 */

export function supabaseUrl(): string | undefined {
  return (
    process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ||
    process.env.SUPABASE_URL?.trim() ||
    undefined
  );
}

/** Browser / SSR key (RLS). `sb_publishable_…` or legacy JWT anon. */
export function supabasePublishableKey(): string | undefined {
  return (
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() ||
    undefined
  );
}

/** Server-only key (bypasses RLS). `sb_secret_…` or legacy JWT service_role. Never expose to the browser. */
export function supabaseSecretKey(): string | undefined {
  return (
    process.env.SUPABASE_SECRET_KEY?.trim() ||
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ||
    undefined
  );
}
