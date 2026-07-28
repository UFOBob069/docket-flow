import { NextResponse } from "next/server";
import { requireIntakeApiUser } from "@/lib/intake-api-auth";
import type { IntakePromoteBody } from "@/lib/intake-types";
import { executePromoteIntakeToCase } from "@/lib/promote-intake";
import { fetchContactsForUser } from "@/lib/supabase/repo";
import { appBaseUrl } from "@/lib/slack-activity";

export const runtime = "nodejs";
export const maxDuration = 120;

type RouteContext = { params: Promise<{ callId: string }> };

export async function POST(req: Request, context: RouteContext): Promise<Response> {
  const auth = await requireIntakeApiUser(req);
  if (!auth.ok) return auth.response;

  const { callId } = await context.params;
  const id = callId?.trim();
  if (!id) return NextResponse.json({ error: "callId required" }, { status: 400 });

  let body: IntakePromoteBody;
  try {
    body = (await req.json()) as IntakePromoteBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const bearer = req.headers.get("authorization");
  const idToken = bearer?.startsWith("Bearer ") ? bearer.slice(7) : null;

  try {
    const contacts = await fetchContactsForUser(auth.supabase, auth.user.id);
    const { caseId } = await executePromoteIntakeToCase(
      auth.supabase,
      id,
      body,
      auth.user,
      idToken,
      contacts.map((c) => c)
    );
    return NextResponse.json({ ok: true, caseId, caseUrl: `${appBaseUrl()}/cases/${caseId}` });
  } catch (e) {
    const status = (e as Error & { status?: number }).status;
    if (status === 404) return NextResponse.json({ error: "Intake not found" }, { status: 404 });
    if (status === 409) return NextResponse.json({ error: "Intake already promoted" }, { status: 409 });
    const message = e instanceof Error ? e.message : "Promote failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
