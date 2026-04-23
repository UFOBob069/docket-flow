import { NextResponse } from "next/server";
import { parseIcsToFutureEvents } from "@/lib/ics-parse";
import { getUserFromBearer } from "@/lib/supabase/auth-server";

export const runtime = "nodejs";

export async function POST(req: Request): Promise<Response> {
  const session = await getUserFromBearer(req.headers.get("authorization"));
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const ct = req.headers.get("content-type") ?? "";
    let text: string;
    if (ct.includes("multipart/form-data")) {
      const form = await req.formData();
      const file = form.get("file");
      if (!(file instanceof File)) {
        return NextResponse.json({ error: "Expected file field" }, { status: 400 });
      }
      text = await file.text();
    } else {
      const body = (await req.json()) as { icsText?: string };
      if (!body.icsText?.trim()) {
        return NextResponse.json({ error: "Expected icsText or multipart file" }, { status: 400 });
      }
      text = body.icsText;
    }

    if (!text.trim()) {
      return NextResponse.json({ error: "Empty calendar file" }, { status: 400 });
    }

    const events = parseIcsToFutureEvents(text);
    return NextResponse.json({ events, count: events.length });
  } catch (e) {
    console.error("[parse-ics]", e);
    const message = e instanceof Error ? e.message : "Parse failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
