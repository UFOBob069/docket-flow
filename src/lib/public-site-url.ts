/**
 * OAuth / links: Supabase `redirect_to` must exactly match an entry under
 * Authentication → URL Configuration → Redirect URLs.
 *
 * On Vercel, set `NEXT_PUBLIC_SITE_URL` to your canonical app URL (e.g. https://your-app.vercel.app)
 * so sign-in always requests that callback — otherwise Supabase may fall back to **Site URL**
 * (often still `http://localhost:3000`) and send the browser there after Google.
 *
 * Leave unset (or use http://localhost:3000) for local `next dev`.
 */
function normalizeOrigin(input: string): string | null {
  const t = input.trim().replace(/\/$/, "");
  if (!t) return null;
  try {
    const u = new URL(t.includes("://") ? t : `https://${t}`);
    return u.origin;
  } catch {
    return null;
  }
}

/** Full URL for Supabase PKCE return (`signInWithOAuth` redirectTo). */
export function getAuthCallbackUrl(): string {
  if (typeof window === "undefined") return "";
  const isLocal =
    window.location.hostname === "localhost" ||
    window.location.hostname === "127.0.0.1";
  const fromEnv = normalizeOrigin(process.env.NEXT_PUBLIC_SITE_URL ?? "");
  const origin = isLocal ? window.location.origin : (fromEnv ?? window.location.origin);
  return `${origin}/auth/callback`;
}
