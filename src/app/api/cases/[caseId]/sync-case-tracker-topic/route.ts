import { NextResponse } from "next/server";
import { requestCaseTrackerSlackTopicSync } from "@/lib/case-tracker-client";
import { getUserFromBearer } from "@/lib/supabase/auth-server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { fetchCase } from "@/lib/supabase/repo";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ caseId: string }> };

/**
 * Browser → DocketFlow → Case Tracker: sync Slack topic after UI contact reassignment.
 * Auth: user Bearer (same pattern as /api/slack/activity).
 */
export async function POST(req: Request, context: RouteContext): Promise<Response> {
  const user = await getUserFromBearer(req.headers.get("authorization"));
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { caseId: rawCaseId } = await context.params;
  const caseId = rawCaseId?.trim();
  if (!caseId) {
    return NextResponse.json({ error: "caseId required" }, { status: 400 });
  }

  const supabase = createServiceRoleClient();
  let caseNumber: string | null = null;
  if (supabase) {
    try {
      const c = await fetchCase(supabase, caseId);
      caseNumber = c?.caseNumber ?? null;
    } catch {
      // Still attempt sync by caseId
    }
  }

  const result = await requestCaseTrackerSlackTopicSync(caseId, {
    caseNumber,
    source: "docketflow",
  });

  return NextResponse.json(result, {
    status: result.ok ? 200 : 502,
  });
}
