import { NextResponse } from "next/server";
import {
  deleteGoogleEvent,
  deleteSolMilestoneGoogleEvent,
  insertGoogleEvent,
  insertSolMilestonesOnConfiguredCalendar,
  patchGoogleEvent,
  patchSolMilestoneGoogleEvent,
  reconcileCalendarEventTeam,
} from "@/lib/google-calendar";
import { buildSolMilestoneSpecs } from "@/lib/sol-milestones";
import { getUserFromBearer } from "@/lib/supabase/auth-server";

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
    startDateTime?: string;
    endDateTime?: string;
    location?: string;
  }[];
  attendeeEmails: string[];
};

type PatchBody = {
  action: "update";
  googleEventId: string;
  googleCalendarEventIdsByEmail?: Record<string, string>;
  /** When set to the configured SOL group calendar, patch uses that calendar + legal-assistant impersonation */
  googleHostCalendarId?: string;
  caseName: string;
  title: string;
  date: string;
  description: string;
  reminderMinutes?: number[];
  startDateTime?: string;
  endDateTime?: string;
  location?: string | null;
};

type DeleteBody = {
  action: "delete";
  googleEventId: string;
  googleCalendarEventIdsByEmail?: Record<string, string>;
  googleHostCalendarId?: string;
};

type CreateSolMilestonesBody = {
  action: "create_sol_milestones";
  caseName: string;
  sourceLabel?: string;
  solDate: string;
  incidentDate: string;
  remindersFinalMinutes: number[];
  milestones: { id: string; date: string; eventKind: string }[];
};

type ReconcileBody = {
  action: "reconcile_team";
  caseName: string;
  sourceLabel?: string;
  attendeeEmails: string[];
  events: {
    title: string;
    date: string;
    description: string;
    reminderMinutes?: number[];
    startDateTime?: string;
    endDateTime?: string;
    location?: string | null;
    googleEventId?: string;
    googleCalendarEventIdsByEmail?: Record<string, string>;
  }[];
};

export async function POST(req: Request): Promise<Response> {
  const session = await getUserFromBearer(req.headers.get("authorization"));
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = (await req.json()) as
      | CreateBody
      | PatchBody
      | DeleteBody
      | ReconcileBody
      | CreateSolMilestonesBody;

    if (body.action === "delete") {
      if (body.googleHostCalendarId) {
        await deleteSolMilestoneGoogleEvent(body.googleEventId, body.googleHostCalendarId);
      } else {
        await deleteGoogleEvent(
          body.googleEventId,
          body.googleCalendarEventIdsByEmail
        );
      }
      return NextResponse.json({ ok: true });
    }

    if (body.action === "update") {
      const summary = body.googleHostCalendarId
        ? body.title
        : `${body.caseName} – ${body.title}`;
      if (body.googleHostCalendarId) {
        await patchSolMilestoneGoogleEvent({
          claimedHostCalendarId: body.googleHostCalendarId,
          googleEventId: body.googleEventId,
          summary,
          description: body.description,
          dateIso: body.startDateTime ? undefined : body.date,
          startDateTime: body.startDateTime,
          endDateTime: body.endDateTime,
          reminderMinutes: body.reminderMinutes ?? [20160, 10080, 1440],
          location: body.location,
        });
      } else {
        await patchGoogleEvent({
          googleEventId: body.googleEventId,
          idsByEmail: body.googleCalendarEventIdsByEmail,
          summary,
          description: body.description,
          dateIso: body.startDateTime ? undefined : body.date,
          startDateTime: body.startDateTime,
          endDateTime: body.endDateTime,
          reminderMinutes: body.reminderMinutes ?? [20160, 10080, 1440],
          location: body.location,
        });
      }
      return NextResponse.json({ ok: true });
    }

    if (body.action === "reconcile_team") {
      const results: {
        organizerEventId: string;
        idsByEmail: Record<string, string>;
      }[] = [];
      for (const ev of body.events) {
        const summary = `${body.caseName} – ${ev.title}`;
        let description = ev.description;
        if (body.sourceLabel) {
          description = `Source: ${body.sourceLabel}\n\n${description}`;
        }
        const r = await reconcileCalendarEventTeam({
          summary,
          description,
          dateIso: ev.date,
          reminderMinutes: ev.reminderMinutes ?? [20160, 10080, 1440],
          startDateTime: ev.startDateTime,
          endDateTime: ev.endDateTime,
          location: ev.location,
          attendeeEmails: body.attendeeEmails,
          idsByEmail: ev.googleCalendarEventIdsByEmail,
          googleEventId: ev.googleEventId,
        });
        results.push({
          organizerEventId: r.organizerEventId,
          idsByEmail: r.idsByEmail,
        });
      }
      return NextResponse.json({ results });
    }

    if (body.action === "create_sol_milestones") {
      const expected = buildSolMilestoneSpecs(
        body.solDate,
        body.incidentDate,
        body.remindersFinalMinutes
      );
      if (body.milestones.length !== expected.length) {
        return NextResponse.json(
          { error: "SOL milestone rows do not match server schedule (count)" },
          { status: 400 }
        );
      }
      for (let i = 0; i < expected.length; i++) {
        const row = body.milestones[i]!;
        const spec = expected[i]!;
        if (row.date !== spec.date || row.eventKind !== spec.eventKind) {
          return NextResponse.json(
            { error: "SOL milestone rows do not match server schedule (dates)" },
            { status: 400 }
          );
        }
      }
      const { googleEventIds, hostCalendarId } = await insertSolMilestonesOnConfiguredCalendar({
        caseName: body.caseName,
        sourceLabel: body.sourceLabel,
        milestones: expected.map((m) => ({
          title: m.title,
          date: m.date,
          description: m.description,
          reminderMinutes: m.reminderMinutes,
          googleSummaryStem: m.googleSummaryStem,
        })),
      });
      return NextResponse.json({ googleEventIds, hostCalendarId });
    }

    if (body.action === "create") {
      const googleEventIds: string[] = [];
      const googleEventIdMaps: Record<string, string>[] = [];
      console.log("[sync] Creating", body.events.length, "events");
      for (const ev of body.events) {
        console.log("[sync] Event:", ev.title, "reminderMinutes:", JSON.stringify(ev.reminderMinutes));
        const summary = `${body.caseName} – ${ev.title}`;
        let description = ev.description;
        if (body.sourceLabel) {
          description = `Source: ${body.sourceLabel}\n\n${description}`;
        }
        const { organizerEventId, idsByEmail } = await insertGoogleEvent({
          summary,
          description,
          dateIso: ev.date,
          attendeeEmails: body.attendeeEmails,
          reminderMinutes: ev.reminderMinutes ?? [20160, 10080, 1440],
          startDateTime: ev.startDateTime,
          endDateTime: ev.endDateTime,
          location: ev.location,
        });
        googleEventIds.push(organizerEventId);
        googleEventIdMaps.push(idsByEmail);
      }
      return NextResponse.json({ googleEventIds, googleEventIdMaps });
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
