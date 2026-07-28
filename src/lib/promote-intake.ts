import type { SupabaseClient } from "@supabase/supabase-js";
import { buildCaseAssignedContactIds } from "@/lib/case-attorneys";
import { formatClientDisplayName } from "@/lib/client-name";
import { createSolMilestoneEvents } from "@/lib/event-factory";
import { isCaseType } from "@/lib/case-types";
import { parseDisplayDate } from "@/lib/date-input-format";
import {
  buildCaseTrackerPatchFromIntake,
  intakePrefillForPromote,
  normalizeIntakeDateYmd,
  splitIntakeClientName,
} from "@/lib/intake-promote";
import type { IntakeFlat, IntakePromoteBody } from "@/lib/intake-types";
import { isPreferredLanguage } from "@/lib/preferred-languages";
import { normalizeUsPhoneToE164 } from "@/lib/phone-format";
import { DEFAULT_REMINDERS } from "@/lib/reminder-presets";
import { adjustSolWeekendToFriday, statuteLimitDateIsoForCalendar } from "@/lib/sol";
import { appBaseUrl } from "@/lib/slack-activity";
import {
  fetchIntakeByCallId,
  linkIntakeToCase,
  upsertCaseTrackerFromIntake,
} from "@/lib/supabase/intake-server";
import { createCase, findCaseByCaseNumber, logActivity, saveEvent } from "@/lib/supabase/repo";
import { isValidNumericCaseNumber } from "@/lib/case-display";
import type { Contact } from "@/lib/types";

export async function executePromoteIntakeToCase(
  supabase: SupabaseClient,
  callId: string,
  body: IntakePromoteBody,
  user: { id: string; email?: string },
  idToken: string | null,
  contacts: Contact[]
): Promise<{ caseId: string }> {
  const intake = await fetchIntakeByCallId(supabase, callId);
  if (!intake) {
    const err = new Error("Intake not found") as Error & { status: number };
    err.status = 404;
    throw err;
  }
  if (intake.case_id) {
    const err = new Error("Intake already promoted") as Error & { status: number };
    err.status = 409;
    throw err;
  }

  const cn = body.caseNumber.trim();
  if (!isValidNumericCaseNumber(cn)) {
    throw new Error("Case number must contain digits only.");
  }
  if (!body.responsibleAttorneyContactId || !body.paralegalContactId) {
    throw new Error("Main attorney and paralegal are required.");
  }
  if (!isPreferredLanguage(body.preferredLanguage)) {
    throw new Error("Select a primary language.");
  }
  if (!isCaseType(body.caseType)) {
    throw new Error("Select a case type.");
  }

  const prefill = intakePrefillForPromote(intake);
  const split = splitIntakeClientName(intake.name);
  const first = (body.clientFirstName ?? split.first).trim();
  const last = (body.clientLastName ?? split.last).trim();
  const cl = formatClientDisplayName(first, last);
  if (!first || !last) throw new Error("Client first and last name are required.");

  const dob = (body.dateOfBirth ?? prefill.dateOfBirth).trim();
  const doi = (body.dateOfIncident ?? prefill.dateOfIncident).trim();
  if (!dob || !doi) throw new Error("Date of birth and date of incident are required.");
  if (!parseDisplayDate(dob) || !parseDisplayDate(doi)) {
    throw new Error("Enter valid dates of birth and incident.");
  }

  let phoneE164: string | null = null;
  if (body.clientAlreadyInQuo === "no") {
    phoneE164 = normalizeUsPhoneToE164(body.clientPhone ?? prefill.clientPhone);
    if (!phoneE164) throw new Error("Enter a valid US client phone number.");
  }

  const injuriesText = (body.injuries ?? prefill.injuries).trim();
  const descriptionText = (body.caseDescription ?? prefill.caseDescription).trim();
  if (!injuriesText || !descriptionText) {
    throw new Error("Injuries and case description are required.");
  }

  const existing = await findCaseByCaseNumber(supabase, cn);
  if (existing) throw new Error(`Case number ${cn} already exists.`);

  const contactById = new Map(contacts.map((c) => [c.id, c]));
  const extraIds = (body.extraAssigneeIds ?? []).filter(
    (id) => id && id !== body.responsibleAttorneyContactId && id !== body.eventAttorneyContactId
  );
  const assignedContactIds = buildCaseAssignedContactIds({
    responsibleAttorneyId: body.responsibleAttorneyContactId,
    paralegalId: body.paralegalContactId,
    extraIds,
    contactById,
  });

  const displayName = `${cl} (${cn})`;
  const sol = adjustSolWeekendToFriday(
    (body.solDate ?? statuteLimitDateIsoForCalendar(doi, 2)).slice(0, 10)
  );
  const solReminders = body.solRemindersMinutes?.length
    ? body.solRemindersMinutes
    : [...DEFAULT_REMINDERS.other];

  const caseId = await createCase(supabase, user.id, {
    name: displayName,
    clientName: cl,
    clientFirstName: first,
    clientLastName: last,
    clientPhone: phoneE164,
    caseNumber: cn,
    causeNumber: cn,
    dateOfBirth: normalizeIntakeDateYmd(dob) ?? dob,
    dateOfIncident: normalizeIntakeDateYmd(doi) ?? doi,
    notes: (body.notes ?? prefill.notes).trim() || null,
    caseType: body.caseType,
    preferredLanguage: body.preferredLanguage,
    secondaryLanguage: body.secondaryLanguage?.trim() || null,
    responsibleAttorneyContactId: body.responsibleAttorneyContactId,
    eventAttorneyContactId: body.eventAttorneyContactId?.trim() || null,
    assignedContactIds,
  });

  const trackerPatch = buildCaseTrackerPatchFromIntake(intake, {
    injuries: injuriesText,
    caseDescription: descriptionText,
  });
  await upsertCaseTrackerFromIntake(supabase, caseId, trackerPatch, user.id);

  const solEvents = createSolMilestoneEvents(
    caseId,
    user.id,
    sol,
    doi,
    solReminders,
    displayName,
    user.email ?? null
  );
  for (const ev of solEvents) {
    await saveEvent(supabase, caseId, ev);
  }

  if (idToken) {
    const calRes = await fetch(`${appBaseUrl()}/api/calendar/sync`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify({
        action: "create_sol_milestones",
        caseName: displayName,
        sourceLabel: "SOL",
        solDate: sol,
        incidentDate: doi,
        remindersFinalMinutes: solReminders,
        milestones: solEvents.map((e) => ({
          id: e.id,
          date: e.date,
          eventKind: e.eventKind ?? "sol",
        })),
      }),
    }).catch(() => null);

    if (calRes?.ok) {
      const calJson = (await calRes.json()) as {
        googleEventIds?: string[];
        hostCalendarId?: string;
      };
      const googleEventIds = calJson.googleEventIds ?? [];
      const hostCalendarId = calJson.hostCalendarId;
      if (googleEventIds.length > 0 && hostCalendarId) {
        for (let i = 0; i < solEvents.length; i++) {
          const ge = googleEventIds[i];
          if (!ge) continue;
          const row = solEvents[i]!;
          await saveEvent(supabase, caseId, {
            ...row,
            googleEventId: ge,
            googleHostCalendarId: hostCalendarId,
            googleCalendarEventIdsByEmail: undefined,
          });
        }
      }
    }
  }

  await linkIntakeToCase(supabase, callId, caseId);

  await logActivity(supabase, user.id, {
    caseId,
    caseName: displayName,
    action: "case_created",
    description: `Promoted from intake call ${callId.slice(0, 8)}…`,
    userEmail: user.email ?? "",
  });

  return { caseId };
}
