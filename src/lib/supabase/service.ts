import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { supabaseSecretKey, supabaseUrl } from "./env";

/** Server-only client that bypasses RLS (cron, admin tasks). */
export function createServiceRoleClient(): SupabaseClient | null {
  const url = supabaseUrl();
  const key = supabaseSecretKey();
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}
