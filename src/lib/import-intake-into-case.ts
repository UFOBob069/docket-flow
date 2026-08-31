import type { SupabaseClient } from "@supabase/supabase-js";
import { caseDisplayName } from "@/lib/case-display";
import { formatClientDisplayName } from "@/lib/client-name";
import {
  buildCaseTrackerPatchFromIntake,
  normalizeIntakeDateYmd,
  splitIntakeClientName,
} from "@/lib/intake-promote";
import { normalizeUsPhoneToE164 } from "@/lib/phone-format";
import {
  fetchIntakeByCallId,
  linkIntakeToCase,
  upsertCaseTrackerFromIntake,
} from "@/lib/supabase/intake-server";
import { fetchCase, logActivity, updateCase } from "@/lib/supabase/repo";
import type { Case } from "@/lib/types";

function isBlank(v: unknown): boolean {
  if (v === null || v === undefined) return true;
  if (typeof v === "string") return v.trim() === "";
  return false;
}

/** Keep only patch keys whose current tracker values are empty. */
export function fillEmptyTrackerPatch(
  existing: Record<string, unknown> | null,
  incoming: Record<string, unknown>
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(incoming)) {
    if (key === "case_stage") continue;
    if (isBlank(value)) continue;
    if (!existing || isBlank(existing[key])) out[key] = value;
  }
  return out;
}

export function buildCaseFillEmptyPatchFromIntake(
  caseRecord: Case,
  intake: {
    name: string | null;
    phone: string | null;
    email: string | null;
    address: string | null;
    dob: string | null;
    accident_date: string | null;
    notes: string | null;
  }
): Partial<Omit<Case, "id" | "ownerId">> {
  const patch: Partial<Omit<Case, "id" | "ownerId">> = {};
  const { first, last } = splitIntakeClientName(intake.name);

  if (isBlank(caseRecord.clientFirstName) && first) patch.clientFirstName = first;
  if (isBlank(caseRecord.clientLastName) && last) patch.clientLastName = last;
  if (
    (patch.clientFirstName !== undefined || patch.clientLastName !== undefined) &&
    isBlank(caseRecord.clientName)
  ) {
    const nextFirst = patch.clientFirstName ?? caseRecord.clientFirstName ?? "";
    const nextLast = patch.clientLastName ?? caseRecord.clientLastName ?? "";
    const display = formatClientDisplayName(nextFirst, nextLast);
    if (display.trim()) patch.clientName = display;
  }

  if (isBlank(caseRecord.clientPhone) && intake.phone?.trim()) {
    patch.clientPhone =
      normalizeUsPhoneToE164(intake.phone) ?? intake.phone.trim();
  }
  if (isBlank(caseRecord.clientEmail) && intake.email?.trim()) {
    patch.clientEmail = intake.email.trim();
  }
  if (isBlank(caseRecord.clientStreetAddress) && intake.address?.trim()) {
    patch.clientStreetAddress = intake.address.trim();
  }
  if (isBlank(caseRecord.dateOfBirth)) {
    const dob = normalizeIntakeDateYmd(intake.dob);
    if (dob) patch.dateOfBirth = dob;
  }
  if (isBlank(caseRecord.dateOfIncident)) {
    const doi = normalizeIntakeDateYmd(intake.accident_date);
    if (doi) patch.dateOfIncident = doi;
  }
  if (isBlank(caseRecord.notes) && intake.notes?.trim()) {
    patch.notes = intake.notes.trim();
  }

  return patch;
}

export type ImportIntakeIntoCaseResult = {
  caseId: string;
  callId: string;
  caseFieldsUpdated: string[];
  trackerFieldsUpdated: string[];
  linked: boolean;
};

/**
 * Link an open intake to an existing case and fill blank case / Case Tracker fields only.
 * Does not create SOL milestones or overwrite non-empty values.
 */
export async function importIntakeIntoCase(
  supabase: SupabaseClient,
  caseId: string,
  callId: string,
  user: { id: string; email?: string }
): Promise<ImportIntakeIntoCaseResult> {
  const caseRecord = await fetchCase(supabase, caseId);
  if (!caseRecord) {
    const err = new Error("Case not found") as Error & { status: number };
    err.status = 404;
    throw err;
  }

  const intake = await fetchIntakeByCallId(supabase, callId);
  if (!intake) {
    const err = new Error("Intake not found") as Error & { status: number };
    err.status = 404;
    throw err;
  }
  if (!intake.call_id) {
    throw new Error("Intake is missing a call id.");
  }
  if (intake.case_id && intake.case_id !== caseId) {
    const err = new Error("This intake is already linked to a different case.") as Error & {
      status: number;
    };
    err.status = 409;
    throw err;
  }

  const casePatch = buildCaseFillEmptyPatchFromIntake(caseRecord, intake);
  const caseFieldsUpdated = Object.keys(casePatch);
  if (caseFieldsUpdated.length) {
    await updateCase(supabase, caseId, casePatch);
  }

  const fullTrackerPatch = buildCaseTrackerPatchFromIntake(intake);
  const { data: existingTracker, error: trackerLookupErr } = await supabase
    .from("case_tracker_entries")
    .select("*")
    .eq("case_id", caseId)
    .maybeSingle();
  if (trackerLookupErr) throw trackerLookupErr;

  const trackerPatch = fillEmptyTrackerPatch(
    (existingTracker as Record<string, unknown> | null) ?? null,
    fullTrackerPatch
  );
  const trackerFieldsUpdated = Object.keys(trackerPatch);
  if (trackerFieldsUpdated.length) {
    await upsertCaseTrackerFromIntake(supabase, caseId, trackerPatch, user.id);
  }

  let linked = false;
  if (!intake.case_id) {
    await linkIntakeToCase(supabase, intake.call_id, caseId);
    linked = true;
  }

  const bits: string[] = [];
  if (linked) bits.push("linked intake");
  if (caseFieldsUpdated.length) bits.push(`filled ${caseFieldsUpdated.length} case field(s)`);
  if (trackerFieldsUpdated.length)
    bits.push(`filled ${trackerFieldsUpdated.length} Case Tracker field(s)`);
  if (!bits.length) bits.push("intake already linked; nothing blank to fill");

  await logActivity(supabase, user.id, {
    caseId,
    caseName: caseDisplayName(caseRecord),
    action: "intake_imported",
    description: `Imported intake ${intake.call_id.slice(0, 10)}… (${bits.join("; ")})`,
    userEmail: user.email ?? "",
  });

  return {
    caseId,
    callId: intake.call_id,
    caseFieldsUpdated,
    trackerFieldsUpdated,
    linked,
  };
}
