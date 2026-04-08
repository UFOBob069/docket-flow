import { NextResponse } from "next/server";
import {
  deleteGoogleEvent,
  insertGoogleEvent,
  patchGoogleEvent,
} from "@/lib/google-calendar";
import { verifyIdToken } from "@/lib/firebase/admin";

export const runtime = "nodejs";

type CreateBody = {
  action: "create";
  caseName: string;
  sourceLabel?: string;
  events: {
    title: string;
    date: string;
    description: string;
    reminderMinutes?: number[];
  }[];
  attendeeEmails: string[];
};

type PatchBody = {
  action: "update";
  googleEventId: string;
  caseName: string;
  title: string;
  date: string;
  description: string;
  attendeeEmails?: string[];
  reminderMinutes?: number[];
};

type DeleteBody = {
  action: "delete";
  googleEventId: string;
};

export async function POST(req: Request): Promise<Response> {
  const session = await verifyIdToken(req.headers.get("authorization"));
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = (await req.json()) as CreateBody | PatchBody | DeleteBody;

    if (body.action === "delete") {
      await deleteGoogleEvent(body.googleEventId);
      return NextResponse.json({ ok: true });
    }

    if (body.action === "update") {
      const summary = `${body.caseName} – ${body.title}`;
      await patchGoogleEvent({
        googleEventId: body.googleEventId,
        summary,
        description: body.description,
        dateIso: body.date,
        attendeeEmails: body.attendeeEmails,
        reminderMinutes: body.reminderMinutes ?? [20160, 10080, 1440],
      });
      return NextResponse.json({ ok: true });
    }

    if (body.action === "create") {
      const googleEventIds: string[] = [];
      console.log("[sync] Creating", body.events.length, "events");
      for (const ev of body.events) {
        console.log("[sync] Event:", ev.title, "reminderMinutes:", JSON.stringify(ev.reminderMinutes));
        const summary = `${body.caseName} – ${ev.title}`;
        let description = ev.description;
        if (body.sourceLabel) {
          description = `Source: ${body.sourceLabel}\n\n${description}`;
        }
        const googleEventId = await insertGoogleEvent({
          summary,
          description,
          dateIso: ev.date,
          attendeeEmails: body.attendeeEmails,
          reminderMinutes: ev.reminderMinutes ?? [20160, 10080, 1440],
        });
        googleEventIds.push(googleEventId);
      }
      return NextResponse.json({ googleEventIds });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (e: unknown) {
    let message = "Calendar sync failed";
    if (e instanceof Error) {
      message = e.message;
    }
    const gaxiosErr = e as { response?: { data?: { error?: { message?: string; code?: number } } } };
    if (gaxiosErr?.response?.data?.error?.message) {
      message = gaxiosErr.response.data.error.message;
    }
    console.error("[calendar/sync]", message, e);
    const status = message.includes("Missing env") ? 503 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
