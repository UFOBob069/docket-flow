import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

export async function GET(request: Request): Promise<Response> {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const tokenHash = requestUrl.searchParams.get("token_hash");
  const type = requestUrl.searchParams.get("type");
  const origin = requestUrl.origin;

  const hasPkceCode = Boolean(code);
  const hasTokenHash =
    Boolean(tokenHash) &&
    Boolean(type) &&
    ["magiclink", "email", "signup", "recovery", "invite"].includes(type ?? "");

  if (!hasPkceCode && !hasTokenHash) {
    return NextResponse.redirect(`${origin}/`);
  }

  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options as CookieOptions)
            );
          } catch {
            /* ignore when called outside a route that allows set-cookie */
          }
        },
      },
    }
  );

  if (hasPkceCode) {
    const { error } = await supabase.auth.exchangeCodeForSession(code!);
    if (error) {
      console.error("[auth/callback] exchangeCodeForSession:", error.message);
      return NextResponse.redirect(`${origin}/login?error=auth`);
    }
  } else if (hasTokenHash && tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({
      type: type as
        | "magiclink"
        | "email"
        | "signup"
        | "recovery"
        | "invite",
      token_hash: tokenHash,
    });
    if (error) {
      console.error("[auth/callback] verifyOtp:", error.message);
      return NextResponse.redirect(`${origin}/login?error=auth`);
    }
  }

  return NextResponse.redirect(`${origin}/`);
}
