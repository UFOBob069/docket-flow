import { NextResponse } from "next/server";
import { requireIntakeApiUser } from "@/lib/intake-api-auth";
import type { IntakeFlat } from "@/lib/intake-types";
import {
  fetchIntakeByCallId,
  fetchIntakeInteractions,
  patchIntakeByCallId,
} from "@/lib/supabase/intake-server";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ callId: string }> };

export async function GET(req: Request, context: RouteContext): Promise<Response> {
  const auth = await requireIntakeApiUser(req);
  if (!auth.ok) return auth.response;

  const { callId } = await context.params;
  const id = callId?.trim();
  if (!id) return NextResponse.json({ error: "callId required" }, { status: 400 });

  try {
    const intake = await fetchIntakeByCallId(auth.supabase, id);
    if (!intake) return NextResponse.json({ error: "Intake not found" }, { status: 404 });
    const interactions = await fetchIntakeInteractions(auth.supabase, id);
    return NextResponse.json({ intake, interactions });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to load intake";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(req: Request, context: RouteContext): Promise<Response> {
  const auth = await requireIntakeApiUser(req);
  if (!auth.ok) return auth.response;

  const { callId } = await context.params;
  const id = callId?.trim();
  if (!id) return NextResponse.json({ error: "callId required" }, { status: 400 });

  let patch: Partial<IntakeFlat>;
  try {
    patch = (await req.json()) as Partial<IntakeFlat>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  try {
    const intake = await patchIntakeByCallId(auth.supabase, id, patch);
    return NextResponse.json({ intake });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to update intake";
    const status = message === "Intake not found" ? 404 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
