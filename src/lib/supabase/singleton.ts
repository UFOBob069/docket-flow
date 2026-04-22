"use client";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseBrowserClient } from "./browser";
import { isSupabaseConfigured } from "./config";

let cached: SupabaseClient | null = null;

/** Single browser Supabase client per tab (safe for Realtime + auth). */
export function getBrowserSupabase(): SupabaseClient {
  if (!isSupabaseConfigured()) {
    throw new Error("Supabase is not configured");
  }
  if (!cached) cached = createSupabaseBrowserClient();
  return cached;
}
