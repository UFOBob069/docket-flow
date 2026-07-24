import type { SupabaseClient } from "@supabase/supabase-js";
import { isGoogleIcsMirrorEvent } from "@/lib/calendar-event-origin";
import { googleCalendarDescription } from "@/lib/calendar-payload";
import { caseCalendarInviteContactIds } from "@/lib/case-attorneys";
import { caseDisplayName } from "@/lib/case-display";
import { mergeAttendeeEmailLists } from "@/lib/calendar-global-recipients";
import { reconcileCalendarEventTeam } from "@/lib/google-calendar";
import { formatActivitySlackMessage } from "@/lib/slack-activity";
import { postSlackChannelMessage } from "@/lib/slack-notify";
import {
  fetchCase,
  fetchContactsForUser,
  fetchEventsForCase,
  fetchSlackChannelForCase,
  logActivity,
  saveEvent,
} from "@/lib/supabase/repo";
import type { Case } from "@/lib/types";

export type ReconcileCaseCalendarResult = {
  ok: true;
  reconciledEventCount: number;
  attendeeEmailCount: number;
  skippedNoGoogle: boolean;
  skippedNoEmails: boolean;
};

/**
 * After Case Tracker (or DocketFlow UI) has already updated assignment columns,
 * reconcile Google Calendar invite copies for synced events on this case.
 */
export async function reconcileCaseCalendarInvitesAfterReassign(
  supabase: SupabaseClient,
  caseId: string,
  opts?: { source?: string }
): Promise<ReconcileCaseCalendarResult> {
  const c = await fetchCase(supabase, caseId);
  if (!c) {
    const err = new Error("Case not found") as Error & { status: number };
    err.status = 404;
    throw err;
  }

  const contacts = await fetchContactsForUser(supabase, c.ownerId);
  const contactById = new Map(contacts.map((ct) => [ct.id, ct]));

  const attendeeContactIds = caseCalendarInviteContactIds({
    assignedContactIds: c.assignedContactIds,
    eventAttorneyContactId: c.eventAttorneyContactId ?? null,
  });
  const caseEmails = attendeeContactIds
    .map((id) => contactById.get(id)?.email?.trim().toLowerCase())
    .filter((e): e is string => Boolean(e));

  const firmWideEmails = contacts
    .filter((ct) => ct.teamCalendarScope === "all_firm_events")
    .map((ct) => ct.email.trim().toLowerCase())
    .filter(Boolean);

  const attendeeEmails = mergeAttendeeEmailLists(caseEmails, firmWideEmails);

  const events = await fetchEventsForCase(supabase, caseId);
  const withGoogle = events.filter(
    (ev) =>
      !isGoogleIcsMirrorEvent(ev) &&
      !ev.googleHostCalendarId &&
      (ev.googleEventId ||
        (ev.googleCalendarEventIdsByEmail && Object.keys(ev.googleCalendarEventIdsByEmail).length > 0))
  );

  if (!withGoogle.length || !attendeeEmails.length) {
    await maybeLogReassignActivity(supabase, c, opts?.source, 0);
    return {
      ok: true,
      reconciledEventCount: 0,
      attendeeEmailCount: attendeeEmails.length,
      skippedNoGoogle: !withGoogle.length,
      skippedNoEmails: !attendeeEmails.length,
    };
  }

  const displayName = caseDisplayName(c);
  for (const ev of withGoogle) {
    const r = await reconcileCalendarEventTeam({
      summary: `${displayName} – ${ev.title}`,
      description: googleCalendarDescription(ev),
      dateIso: ev.date,
      reminderMinutes: ev.remindersMinutes?.length ? ev.remindersMinutes : [20160, 10080, 1440],
      startDateTime: ev.startDateTime ?? undefined,
      endDateTime: ev.endDateTime ?? undefined,
      deadlineEndDate: ev.startDateTime ? undefined : (ev.deadlineEndDate ?? null),
      location: ev.zoomLink?.trim() ?? "",
      googleColorId: ev.googleColorId,
      attendeeEmails,
      idsByEmail: ev.googleCalendarEventIdsByEmail,
      googleEventId: ev.googleEventId,
      scheduleKind: ev.scheduleKind,
    });
    await saveEvent(supabase, caseId, {
      ...ev,
      googleEventId: r.organizerEventId,
      googleCalendarEventIdsByEmail: r.idsByEmail,
      updatedAt: Date.now(),
    });
  }

  await maybeLogReassignActivity(supabase, c, opts?.source, withGoogle.length);
  return {
    ok: true,
    reconciledEventCount: withGoogle.length,
    attendeeEmailCount: attendeeEmails.length,
    skippedNoGoogle: false,
    skippedNoEmails: false,
  };
}

async function maybeLogReassignActivity(
  supabase: SupabaseClient,
  c: Case,
  source: string | undefined,
  reconciledEventCount: number
): Promise<void> {
  const sourceLabel = source?.trim() || "internal";
  const description =
    reconciledEventCount > 0
      ? `Reassigned contacts (${sourceLabel}); updated Google Calendar for ${reconciledEventCount} synced event${reconciledEventCount === 1 ? "" : "s"}`
      : `Reassigned contacts (${sourceLabel})`;
  const userEmail = sourceLabel === "case-tracker" ? "case-tracker@internal" : "docketflow@internal";
  const slackWho = sourceLabel === "case-tracker" ? "Case Tracker" : "DocketFlow";

  try {
    await logActivity(supabase, c.ownerId, {
      caseId: c.id,
      caseName: caseDisplayName(c),
      action: "contacts_reassigned",
      description,
      userEmail,
    });
  } catch (e) {
    console.warn("[reassign-calendar] activity log failed", e);
  }

  try {
    if (!process.env.SLACK_BOT_TOKEN?.trim()) return;
    const slack = await fetchSlackChannelForCase(supabase, {
      caseNumber: c.caseNumber ?? null,
      causeNumber: c.causeNumber ?? null,
    });
    if (!slack?.slackChannelId) return;
    const text = formatActivitySlackMessage({
      caseId: c.id,
      caseName: caseDisplayName(c),
      action: "contacts_reassigned",
      description,
      userEmail: slackWho,
    });
    await postSlackChannelMessage(slack.slackChannelId, text);
  } catch (e) {
    console.warn("[reassign-calendar] Slack notify failed", e);
  }
}
