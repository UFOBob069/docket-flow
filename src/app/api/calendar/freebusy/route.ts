import { NextResponse } from "next/server";
import { fetchAllFirmEventsContactEmails, mergeAttendeeEmailLists } from "@/lib/calendar-global-recipients";
import { queryMeetingOpenSlotStarts } from "@/lib/google-calendar";
import { getUserFromBearer } from "@/lib/supabase/auth-server";

export const runtime = "nodejs";

type Body = {
  timeMin: string;
  timeMax: string;
  durationMinutes: number;
  attendeeEmails: string[];
};

export async function POST(req: Request): Promise<Response> {
  const session = await getUserFromBearer(req.headers.get("authorization"));
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = (await req.json()) as Body;
    const timeMin = typeof body.timeMin === "string" ? body.timeMin.trim() : "";
    const timeMax = typeof body.timeMax === "string" ? body.timeMax.trim() : "";
    const durationMinutes = Number(body.durationMinutes);
    const raw = Array.isArray(body.attendeeEmails) ? body.attendeeEmails : [];

    if (!timeMin || !timeMax) {
      return NextResponse.json({ error: "timeMin and timeMax are required" }, { status: 400 });
    }

    const firmWide = await fetchAllFirmEventsContactEmails(req.headers.get("authorization"));
    const attendeeEmails = mergeAttendeeEmailLists(
      raw.map((e) => String(e).trim().toLowerCase()).filter(Boolean),
      firmWide
    );

    if (attendeeEmails.length === 0) {
      return NextResponse.json(
        { error: "Add at least one invitee with an email (assignees, firm-wide contacts, or one-time addresses)." },
        { status: 400 }
      );
    }

    const result = await queryMeetingOpenSlotStarts({
      timeMin,
      timeMax,
      durationMinutes,
      attendeeEmails,
    });

    return NextResponse.json(result);
  } catch (e: unknown) {
    let message = "FreeBusy query failed";
    if (e instanceof Error) message = e.message;
    const gaxiosErr = e as { response?: { data?: { error?: { message?: string } } } };
    if (gaxiosErr?.response?.data?.error?.message) {
      message = gaxiosErr.response.data.error.message;
    }
    console.error("[calendar/freebusy]", message, e);
    const status = message.includes("Set GOOGLE_") ? 503 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
