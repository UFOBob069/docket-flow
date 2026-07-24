import { NextResponse } from "next/server";
import { authorizeInternalApiBearer } from "@/lib/internal-api-auth";
import { reconcileCaseCalendarInvitesAfterReassign } from "@/lib/reassign-calendar";
import { createServiceRoleClient } from "@/lib/supabase/service";

export const runtime = "nodejs";
/** Per-event Google Calendar reconcile can take a while on large cases. */
export const maxDuration = 120;

type RouteContext = { params: Promise<{ caseId: string }> };

export async function POST(req: Request, context: RouteContext): Promise<Response> {
  if (!authorizeInternalApiBearer(req.headers.get("authorization"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { caseId: rawCaseId } = await context.params;
  const caseId = rawCaseId?.trim();
  if (!caseId) {
    return NextResponse.json({ error: "caseId required" }, { status: 400 });
  }

  let source: string | undefined;
  try {
    const body = (await req.json()) as { source?: string };
    if (typeof body?.source === "string") source = body.source;
  } catch {
    // Body is optional
  }

  const supabase = createServiceRoleClient();
  if (!supabase) {
    return NextResponse.json(
      { error: "SUPABASE_SERVICE_ROLE_KEY not configured" },
      { status: 503 }
    );
  }

  try {
    const result = await reconcileCaseCalendarInvitesAfterReassign(supabase, caseId, {
      source,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    const status = (e as Error & { status?: number }).status;
    if (status === 404 || (e instanceof Error && e.message === "Case not found")) {
      return NextResponse.json({ error: "Case not found" }, { status: 404 });
    }
    const message = e instanceof Error ? e.message : "Calendar reconcile failed";
    console.error("[reassign-calendar]", caseId, message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
