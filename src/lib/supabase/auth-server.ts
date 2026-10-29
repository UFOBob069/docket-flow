import { createClient } from "@supabase/supabase-js";
import { supabasePublishableKey, supabaseUrl } from "./env";

/** Verify a Supabase JWT from `Authorization: Bearer <jwt>` (API routes). */
export async function getUserFromBearer(
  bearer: string | null
): Promise<{ id: string; email?: string } | null> {
  if (!bearer?.startsWith("Bearer ")) return null;
  const jwt = bearer.slice(7);
  const url = supabaseUrl();
  const publishable = supabasePublishableKey();
  if (!url || !publishable) {
    if (process.env.NODE_ENV === "development") {
      console.warn("NEXT_PUBLIC_SUPABASE_* missing — API auth disabled in development");
      return { id: "dev" };
    }
    return null;
  }
  const supabase = createClient(url, publishable);
  const { data, error } = await supabase.auth.getUser(jwt);
  if (error || !data.user) return null;
  return { id: data.user.id, email: data.user.email ?? undefined };
}
