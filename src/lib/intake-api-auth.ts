import { NextResponse } from "next/server";
import { getUserFromBearer } from "@/lib/supabase/auth-server";
import { createServiceRoleClient } from "@/lib/supabase/service";

export function intakeApiUnauthorized(): Response {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

export function intakeServiceClientOr503(): SupabaseClientResult {
  const supabase = createServiceRoleClient();
  if (!supabase) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "SUPABASE_SERVICE_ROLE_KEY not configured" },
        { status: 503 }
      ),
    };
  }
  return { ok: true, supabase };
}

type SupabaseClientResult =
  | { ok: true; supabase: NonNullable<ReturnType<typeof createServiceRoleClient>> }
  | { ok: false; response: Response };

export async function requireIntakeApiUser(req: Request) {
  const user = await getUserFromBearer(req.headers.get("authorization"));
  if (!user) return { ok: false as const, response: intakeApiUnauthorized() };
  const svc = intakeServiceClientOr503();
  if (!svc.ok) return { ok: false as const, response: svc.response };
  return { ok: true as const, user, supabase: svc.supabase };
}
