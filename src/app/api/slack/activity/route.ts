import { NextResponse } from "next/server";
import { fetchSlackChannelForCase } from "@/lib/supabase/repo";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { getUserFromBearer } from "@/lib/supabase/auth-server";
import { formatActivitySlackMessage, type SlackActivityPayload } from "@/lib/slack-activity";
import { postSlackChannelMessage } from "@/lib/slack-notify";
import type { ActivityAction } from "@/lib/types";

export const runtime = "nodejs";

const ACTIONS = new Set<ActivityAction>([
  "case_created",
  "case_archived",
  "case_activated",
  "case_deleted",
  "event_created",
  "event_edited",
  "event_deleted",
  "events_bulk_deleted",
  "events_bulk_rescheduled",
  "contacts_reassigned",
]);

export async function POST(req: Request): Promise<Response> {
  const user = await getUserFromBearer(req.headers.get("authorization"));
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!process.env.SLACK_BOT_TOKEN?.trim()) {
    return NextResponse.json({ ok: true, posted: false, reason: "slack_not_configured" });
  }

  let body: SlackActivityPayload;
  try {
    body = (await req.json()) as SlackActivityPayload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const caseId = body.caseId?.trim();
  if (!caseId) {
    return NextResponse.json({ ok: true, posted: false, reason: "no_case" });
  }
  if (!body.action || !ACTIONS.has(body.action)) {
    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  }
  if (!body.description?.trim() || !body.userEmail?.trim()) {
    return NextResponse.json({ error: "description and userEmail required" }, { status: 400 });
  }

  const supabase = createServiceRoleClient();
  if (!supabase) {
    return NextResponse.json({ error: "Server database not configured" }, { status: 503 });
  }

  try {
    const { data: caseRow, error: caseErr } = await supabase
      .from("cases")
      .select("case_number, cause_number")
      .eq("id", caseId)
      .maybeSingle();
    if (caseErr) throw caseErr;
    if (!caseRow) {
      return NextResponse.json({ ok: true, posted: false, reason: "case_not_found" });
    }

    const slack = await fetchSlackChannelForCase(supabase, {
      caseNumber: (caseRow.case_number as string) ?? null,
      causeNumber: (caseRow.cause_number as string) ?? null,
    });
    if (!slack?.slackChannelId) {
      return NextResponse.json({ ok: true, posted: false, reason: "no_slack_channel" });
    }

    const text = formatActivitySlackMessage({
      caseId,
      caseName: body.caseName,
      action: body.action,
      description: body.description.trim(),
      userEmail: body.userEmail.trim(),
    });

    await postSlackChannelMessage(slack.slackChannelId, text);
    return NextResponse.json({ ok: true, posted: true, channelId: slack.slackChannelId });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Slack post failed";
    console.error("[slack/activity]", message, e);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
