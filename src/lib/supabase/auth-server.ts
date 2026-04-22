import { createClient } from "@supabase/supabase-js";

/** Verify a Supabase JWT from `Authorization: Bearer <jwt>` (API routes). */
export async function getUserFromBearer(
  bearer: string | null
): Promise<{ id: string; email?: string } | null> {
  if (!bearer?.startsWith("Bearer ")) return null;
  const jwt = bearer.slice(7);
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) {
    if (process.env.NODE_ENV === "development") {
      console.warn("NEXT_PUBLIC_SUPABASE_* missing — API auth disabled in development");
      return { id: "dev" };
    }
    return null;
  }
  const supabase = createClient(url, anon);
  const { data, error } = await supabase.auth.getUser(jwt);
  if (error || !data.user) return null;
  return { id: data.user.id, email: data.user.email ?? undefined };
}
