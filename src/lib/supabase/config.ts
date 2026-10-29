import { supabasePublishableKey, supabaseUrl } from "./env";

/** Client-safe env check for Supabase web keys. */
export function isSupabaseConfigured(): boolean {
  return Boolean(supabaseUrl() && supabasePublishableKey());
}
