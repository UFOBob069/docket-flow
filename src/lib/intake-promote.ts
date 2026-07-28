import { parseDisplayDate } from "@/lib/date-input-format";
import { formatUsPhoneDisplay, normalizeUsPhoneToE164 } from "@/lib/phone-format";
import type { IntakeFlat } from "@/lib/intake-types";

export function splitIntakeClientName(name: string | null | undefined): {
  first: string;
  last: string;
} {
  const t = (name ?? "").trim();
  if (!t) return { first: "", last: "" };
  const i = t.indexOf(" ");
  if (i < 0) return { first: t, last: "" };
  return { first: t.slice(0, i).trim(), last: t.slice(i + 1).trim() };
}

/** Normalize intake date text to YYYY-MM-DD when possible. */
export function normalizeIntakeDateYmd(raw: string | null | undefined): string | null {
  const t = (raw ?? "").trim();
  if (!t) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  const parsed = parseDisplayDate(t);
  return parsed ?? null;
}

function boolLabel(v: boolean | null | undefined, yes = "Yes", no = "No"): string | null {
  if (v === null || v === undefined) return null;
  return v ? yes : no;
}

function joinLines(parts: (string | null | undefined)[], sep = "\n"): string | null {
  const lines = parts.map((p) => p?.trim()).filter(Boolean) as string[];
  return lines.length ? lines.join(sep) : null;
}

function joinComma(parts: (string | null | undefined)[]): string | null {
  const items = parts.map((p) => p?.trim()).filter(Boolean) as string[];
  return items.length ? items.join(", ") : null;
}

/** Build injuries text from intake injury section when not overridden. */
export function intakeInjuriesText(intake: IntakeFlat): string {
  return (
    joinLines([
      intake.injury_types ? `Injuries: ${intake.injury_types}` : null,
      intake.hospital ? `Hospital: ${intake.hospital}` : null,
      intake.treating_doctor ? `Treating doctor: ${intake.treating_doctor}` : null,
      boolLabel(intake.ems) ? `EMS: ${boolLabel(intake.ems)}` : null,
      boolLabel(intake.hospital_bill) ? `Hospital bill: ${boolLabel(intake.hospital_bill)}` : null,
      intake.health_insurance ? `Health insurance: ${intake.health_insurance}` : null,
      boolLabel(intake.medicaid) ? `Medicaid: ${boolLabel(intake.medicaid)}` : null,
      boolLabel(intake.medicare) ? `Medicare: ${boolLabel(intake.medicare)}` : null,
    ]) ?? ""
  );
}

/** Build case description from accident narrative when not overridden. */
export function intakeCaseDescriptionText(intake: IntakeFlat): string {
  return (
    joinLines([
      intake.accident_description,
      intake.accident_location ? `Location: ${intake.accident_location}` : null,
      joinComma([intake.city, intake.county]) ? `Area: ${joinComma([intake.city, intake.county])}` : null,
      intake.accident_time ? `Time: ${intake.accident_time}` : null,
      intake.police_department ? `Police: ${intake.police_department}` : null,
      intake.police_report_no ? `Report #: ${intake.police_report_no}` : null,
      boolLabel(intake.ticket_issued) ? `Ticket issued: ${boolLabel(intake.ticket_issued)}` : null,
      intake.ticket_who ? `Ticket to: ${intake.ticket_who}` : null,
      intake.ticket_reason ? `Ticket reason: ${intake.ticket_reason}` : null,
    ]) ?? ""
  );
}

function intakeSourcesText(intake: IntakeFlat): string | null {
  return joinLines([
    intake.how_found ? `How found: ${intake.how_found}` : null,
    intake.map_location ? `Map / location: ${intake.map_location}` : null,
  ]);
}

function intakePolicyInfoText(intake: IntakeFlat): string | null {
  return joinLines([
    intake.client_insurance ? `Client carrier: ${intake.client_insurance}` : null,
    intake.client_policy_no ? `Client policy #: ${intake.client_policy_no}` : null,
    intake.client_claim_no ? `Client claim #: ${intake.client_claim_no}` : null,
    intake.third_party_insurance ? `Third-party carrier: ${intake.third_party_insurance}` : null,
    intake.third_party_policy_no ? `Third-party policy #: ${intake.third_party_policy_no}` : null,
    intake.third_party_claim_no ? `Third-party claim #: ${intake.third_party_claim_no}` : null,
    boolLabel(intake.pip) ? `PIP: ${boolLabel(intake.pip)}` : null,
    boolLabel(intake.med_pay) ? `Med pay: ${boolLabel(intake.med_pay)}` : null,
    boolLabel(intake.um_uim) ? `UM/UIM: ${boolLabel(intake.um_uim)}` : null,
  ]);
}

function intakeStatusNotesOverflow(intake: IntakeFlat): string | null {
  return joinLines([
    "--- Property damage ---",
    intake.vehicle ? `Vehicle: ${intake.vehicle}` : null,
    intake.vehicle_owner ? `Owner: ${intake.vehicle_owner}` : null,
    boolLabel(intake.drivable) ? `Drivable: ${boolLabel(intake.drivable)}` : null,
    boolLabel(intake.towed) ? `Towed: ${boolLabel(intake.towed)}` : null,
    intake.towed_by ? `Towed by: ${intake.towed_by}` : null,
    intake.vehicle_location ? `Vehicle location: ${intake.vehicle_location}` : null,
    boolLabel(intake.has_loan) ? `Loan: ${boolLabel(intake.has_loan)}` : null,
    intake.lienholder ? `Lienholder: ${intake.lienholder}` : null,
    boolLabel(intake.rental_needed) ? `Rental needed: ${boolLabel(intake.rental_needed)}` : null,
    intake.body_shop ? `Body shop: ${intake.body_shop}` : null,
    "--- Employment ---",
    intake.employer ? `Employer: ${intake.employer}` : null,
    intake.job_description ? `Job: ${intake.job_description}` : null,
    boolLabel(intake.missed_work) ? `Missed work: ${boolLabel(intake.missed_work)}` : null,
    intake.salary_rate ? `Salary/rate: ${intake.salary_rate}` : null,
    "--- Other driver ---",
    intake.other_driver_name ? `Name: ${intake.other_driver_name}` : null,
    intake.other_driver_phone ? `Phone: ${intake.other_driver_phone}` : null,
    intake.other_driver_dob ? `DOB: ${intake.other_driver_dob}` : null,
    intake.other_driver_address ? `Address: ${intake.other_driver_address}` : null,
    intake.other_driver_dl ? `DL: ${intake.other_driver_dl}` : null,
    intake.other_driver_car_owner ? `Car owner: ${intake.other_driver_car_owner}` : null,
    "--- Client (extra) ---",
    intake.email ? `Email: ${intake.email}` : null,
    intake.address ? `Address: ${intake.address}` : null,
    intake.sex ? `Sex: ${intake.sex}` : null,
    intake.dl_number ? `DL: ${intake.dl_number}` : null,
    intake.spouse_name ? `Spouse: ${intake.spouse_name}` : null,
    intake.emergency_contact ? `Emergency contact: ${intake.emergency_contact}` : null,
    intake.passengers ? `Passengers: ${intake.passengers}` : null,
    intake.representation_date ? `Representation date: ${intake.representation_date}` : null,
  ]);
}

/** Non-empty `case_tracker_entries` columns derived from intake (only set when source has data). */
export function buildCaseTrackerPatchFromIntake(
  intake: IntakeFlat,
  overrides?: { injuries?: string; caseDescription?: string }
): Record<string, unknown> {
  const injuries = (overrides?.injuries ?? intakeInjuriesText(intake)).trim();
  const caseDescription = (overrides?.caseDescription ?? intakeCaseDescriptionText(intake)).trim();
  const sources = intakeSourcesText(intake);
  const policyInfo = intakePolicyInfoText(intake);
  const statusNotes = intakeStatusNotesOverflow(intake);
  const phoneE164 = normalizeUsPhoneToE164(intake.phone ?? "");
  const doi = normalizeIntakeDateYmd(intake.accident_date);

  const row: Record<string, unknown> = { case_stage: "Intake" };
  if (injuries) row.injuries = injuries;
  if (caseDescription) row.case_description = caseDescription;
  if (sources) row.sources = sources;
  if (policyInfo) row.policy_info_source = policyInfo;
  if (statusNotes) row.status_notes = statusNotes;
  if (phoneE164) row.client_phone = phoneE164;
  else if (intake.phone?.trim()) row.client_phone = formatUsPhoneDisplay(intake.phone) || intake.phone.trim();
  if (doi) row.date_of_incident_override = doi;
  return row;
}

export function intakePrefillForPromote(intake: IntakeFlat) {
  const { first, last } = splitIntakeClientName(intake.name);
  const dob = normalizeIntakeDateYmd(intake.dob);
  const doi = normalizeIntakeDateYmd(intake.accident_date);
  return {
    clientFirstName: first,
    clientLastName: last,
    clientPhone: intake.phone ?? "",
    dateOfBirth: dob ?? "",
    dateOfIncident: doi ?? "",
    notes: intake.notes?.trim() ?? "",
    injuries: intakeInjuriesText(intake),
    caseDescription: intakeCaseDescriptionText(intake),
    quoLink: intake.quo_link,
  };
}
