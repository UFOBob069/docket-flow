import { NextResponse } from "next/server";
import { importIntakeIntoCase } from "@/lib/import-intake-into-case";
import { requireIntakeApiUser } from "@/lib/intake-api-auth";
import { caseDisplayName } from "@/lib/case-display";
import { formatActivitySlackMessage } from "@/lib/slack-activity";
import { postSlackChannelMessage } from "@/lib/slack-notify";
import { fetchCase, fetchSlackChannelForCase } from "@/lib/supabase/repo";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ caseId: string }> };

export async function POST(req: Request, context: RouteContext): Promise<Response> {
  const auth = await requireIntakeApiUser(req);
  if (!auth.ok) return auth.response;

  const { caseId: rawCaseId } = await context.params;
  const caseId = rawCaseId?.trim();
  if (!caseId) {
    return NextResponse.json({ error: "caseId required" }, { status: 400 });
  }

  let callId = "";
  try {
    const body = (await req.json()) as { callId?: string };
    callId = typeof body?.callId === "string" ? body.callId.trim() : "";
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!callId) {
    return NextResponse.json({ error: "callId required" }, { status: 400 });
  }

  try {
    const result = await importIntakeIntoCase(auth.supabase, caseId, callId, {
      id: auth.user.id,
      email: auth.user.email,
    });

    if (process.env.SLACK_BOT_TOKEN?.trim()) {
      try {
        const c = await fetchCase(auth.supabase, caseId);
        const slack = c
          ? await fetchSlackChannelForCase(auth.supabase, {
              caseNumber: c.caseNumber ?? null,
              causeNumber: c.causeNumber ?? null,
            })
          : null;
        if (slack?.slackChannelId && c) {
          const text = formatActivitySlackMessage({
            caseId,
            caseName: caseDisplayName(c),
            action: "intake_imported",
            description: `Imported intake ${callId.slice(0, 10)}… (${[
              result.linked ? "linked" : null,
              result.caseFieldsUpdated.length
                ? `${result.caseFieldsUpdated.length} case field(s)`
                : null,
              result.trackerFieldsUpdated.length
                ? `${result.trackerFieldsUpdated.length} tracker field(s)`
                : null,
            ]
              .filter(Boolean)
              .join("; ") || "no blank fields"})`,
            userEmail: auth.user.email ?? "",
          });
          await postSlackChannelMessage(slack.slackChannelId, text);
        }
      } catch (e) {
        console.warn("[import-intake] Slack notify failed", e);
      }
    }

    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    const status = (e as Error & { status?: number }).status;
    const message = e instanceof Error ? e.message : "Import failed";
    if (status === 404) return NextResponse.json({ error: message }, { status: 404 });
    if (status === 409) return NextResponse.json({ error: message }, { status: 409 });
    console.error("[import-intake]", caseId, callId, message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
