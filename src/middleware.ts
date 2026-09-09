import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { canAccessFirmAdminTools, isFirmAdminPath } from "@/lib/admin-access";

/**
 * Refreshes Supabase auth cookies on navigation (PKCE / server-rendered routes).
 * Safe no-op when Supabase env is missing (local static preview).
 * Firm admin paths (Missing sync, Closed invites, Backfill) are limited to david@ramosjames.com.
 */
export async function middleware(request: NextRequest): Promise<NextResponse> {
  /** Supabase sometimes returns the PKCE `code` on `/` when Site URL has no path; exchange needs `/auth/callback`. */
  if (request.nextUrl.pathname === "/" && request.nextUrl.searchParams.has("code")) {
    const next = request.nextUrl.clone();
    next.pathname = "/auth/callback";
    return NextResponse.redirect(next);
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) {
    return NextResponse.next({ request });
  }

  let response = NextResponse.next({
    request: { headers: request.headers },
  });

  const supabase = createServerClient(url, anon, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({
          request: { headers: request.headers },
        });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options as CookieOptions | undefined)
        );
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (isFirmAdminPath(request.nextUrl.pathname) && !canAccessFirmAdminTools(user?.email)) {
    const home = request.nextUrl.clone();
    home.pathname = "/";
    home.search = "";
    return NextResponse.redirect(home);
  }

  return response;
}

export const config = {
  matcher: [
    /*
     * Skip API routes: they use Bearer auth (no cookie refresh) and some handlers run
     * 25s+ (Google Calendar per-attendee creates). Edge middleware times out at ~25s.
     */
    "/((?!_next/static|_next/image|favicon.ico|api/|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
