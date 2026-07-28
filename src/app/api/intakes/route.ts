import { NextResponse } from "next/server";
import { requireIntakeApiUser } from "@/lib/intake-api-auth";
import { fetchIntakesList } from "@/lib/supabase/intake-server";

export const runtime = "nodejs";

export async function GET(req: Request): Promise<Response> {
  const auth = await requireIntakeApiUser(req);
  if (!auth.ok) return auth.response;

  const url = new URL(req.url);
  const q = url.searchParams.get("q") ?? undefined;
  const status = (url.searchParams.get("status") as "open" | "promoted" | "all") || "open";
  const limit = Number(url.searchParams.get("limit") ?? "50");
  const offset = Number(url.searchParams.get("offset") ?? "0");

  try {
    const items = await fetchIntakesList(auth.supabase, { q, status, limit, offset });
    return NextResponse.json({ items });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to load intakes";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
