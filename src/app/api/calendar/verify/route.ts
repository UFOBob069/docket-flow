import { NextResponse } from "next/server";
import {
  idsByEmailForVerification,
  verifyGoogleEventCopy,
} from "@/lib/google-calendar";
import { verifyIdToken } from "@/lib/firebase/admin";

export const runtime = "nodejs";
export const maxDuration = 120;

type Body = {
  events: {
    title: string;
    date: string;
    googleEventId?: string;
    googleCalendarEventIdsByEmail?: Record<string, string>;
  }[];
};

export async function POST(req: Request): Promise<Response> {
  const session = await verifyIdToken(req.headers.get("authorization"));
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = (await req.json()) as Body;
    if (!body.events?.length) {
      return NextResponse.json(
        { error: "No events to verify" },
        { status: 400 }
      );
    }

    const checkedAt = new Date().toISOString();
    const results: {
      title: string;
      date: string;
      checks: Awaited<ReturnType<typeof verifyGoogleEventCopy>>[];
    }[] = [];

    for (const ev of body.events) {
      const map = idsByEmailForVerification(
        ev.googleCalendarEventIdsByEmail,
        ev.googleEventId
      );
      const checks: Awaited<ReturnType<typeof verifyGoogleEventCopy>>[] = [];
      for (const [email, eventId] of Object.entries(map)) {
        checks.push(await verifyGoogleEventCopy(email, eventId, ev.date));
      }
      results.push({ title: ev.title, date: ev.date, checks });
    }

    const totalChecks = results.reduce((n, r) => n + r.checks.length, 0);
    const failed = results.reduce(
      (n, r) => n + r.checks.filter((c) => !c.ok).length,
      0
    );

    return NextResponse.json({
      checkedAt,
      events: results,
      summary: { totalChecks, failed, ok: totalChecks - failed },
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Verify failed";
    console.error("[calendar/verify]", message, e);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
