import type { IntakeFlat } from "@/lib/intake-types";

export function isIntakeFilled(v: unknown): boolean {
  if (v === null || v === undefined) return false;
  if (typeof v === "boolean") return true;
  return String(v).trim() !== "";
}

export function formatIntakeValue(v: unknown): string {
  if (!isIntakeFilled(v)) return "Not provided";
  if (typeof v === "boolean") return v ? "Yes" : "No";
  return String(v).trim();
}

export function formatIntakeWhen(iso: string | null | undefined): string {
  if (!iso) return "Not provided";
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

export function intakeLocationLine(intake: IntakeFlat): string | null {
  const parts = [intake.accident_location, intake.city, intake.county]
    .map((p) => p?.trim())
    .filter(Boolean);
  return parts.length ? parts.join(", ") : null;
}

export function intakeInsuranceStatus(intake: IntakeFlat): string {
  const bits: string[] = [];
  if (isIntakeFilled(intake.client_insurance)) bits.push(`Client: ${intake.client_insurance}`);
  if (isIntakeFilled(intake.third_party_insurance)) bits.push(`Third party: ${intake.third_party_insurance}`);
  if (intake.pip === true) bits.push("PIP");
  if (intake.med_pay === true) bits.push("Med pay");
  if (intake.um_uim === true) bits.push("UM/UIM");
  if (isIntakeFilled(intake.health_insurance)) bits.push(`Health: ${intake.health_insurance}`);
  return bits.length ? bits.join(" · ") : "Not provided";
}

export function intakeTreatmentStatus(intake: IntakeFlat): string {
  const bits: string[] = [];
  if (intake.ems === true) bits.push("EMS involved");
  if (isIntakeFilled(intake.hospital)) bits.push(`Hospital: ${intake.hospital}`);
  if (isIntakeFilled(intake.treating_doctor)) bits.push(`Doctor: ${intake.treating_doctor}`);
  if (intake.hospital_bill === true) bits.push("Hospital bill noted");
  if (bits.length) return bits.join(" · ");
  if (intake.ems === false && !isIntakeFilled(intake.hospital) && !isIntakeFilled(intake.treating_doctor)) {
    return "Not yet treating / no treatment recorded";
  }
  return "Not provided";
}

export function intakeRepresentationStatus(intake: IntakeFlat): string {
  if (isIntakeFilled(intake.representation_date)) {
    return `Representation date: ${intake.representation_date}`;
  }
  return "Not provided";
}

export function intakePoliceStatus(intake: IntakeFlat): string {
  const bits: string[] = [];
  if (isIntakeFilled(intake.police_department)) bits.push(String(intake.police_department));
  if (isIntakeFilled(intake.police_report_no)) bits.push(`Report # ${intake.police_report_no}`);
  if (intake.ticket_issued === true) {
    bits.push(
      ["Ticket issued", intake.ticket_who, intake.ticket_reason].filter(isIntakeFilled).join(" — ")
    );
  } else if (intake.ticket_issued === false) {
    bits.push("No ticket");
  }
  return bits.length ? bits.join(" · ") : "Not provided";
}

export function buildIncidentSummary(intake: IntakeFlat): string {
  if (isIntakeFilled(intake.accident_description)) return String(intake.accident_description).trim();
  if (isIntakeFilled(intake.notes)) return String(intake.notes).trim();
  if (isIntakeFilled(intake.transcript)) {
    const t = String(intake.transcript).trim();
    return t.length > 420 ? `${t.slice(0, 417)}…` : t;
  }
  return "No incident summary has been captured yet.";
}

export type MissingFieldItem = {
  key: keyof IntakeFlat;
  label: string;
  priority: "critical" | "important" | "other";
};

const MISSING_FIELD_DEFS: MissingFieldItem[] = [
  { key: "hospital", label: "Current medical treatment / hospital", priority: "critical" },
  { key: "treating_doctor", label: "Treating doctor", priority: "critical" },
  { key: "client_insurance", label: "Client insurance", priority: "critical" },
  { key: "third_party_insurance", label: "Third-party insurance", priority: "critical" },
  { key: "representation_date", label: "Existing attorney / representation", priority: "critical" },
  { key: "police_report_no", label: "Police / incident report #", priority: "critical" },
  { key: "accident_location", label: "Full accident location", priority: "critical" },
  { key: "injury_types", label: "Injury details", priority: "critical" },
  { key: "accident_date", label: "Date of accident", priority: "critical" },
  { key: "emergency_contact", label: "Emergency contact", priority: "important" },
  { key: "employer", label: "Employer", priority: "important" },
  { key: "vehicle", label: "Property damage / vehicle", priority: "important" },
  { key: "passengers", label: "Passengers / witnesses", priority: "important" },
  { key: "other_driver_name", label: "Other driver information", priority: "important" },
  { key: "dob", label: "Date of birth", priority: "other" },
  { key: "email", label: "Email", priority: "other" },
  { key: "address", label: "Address", priority: "other" },
  { key: "how_found", label: "Referral source", priority: "other" },
  { key: "notes", label: "Additional notes", priority: "other" },
];

/** Empty qualification-relevant fields, prioritized. */
export function getMissingIntakeFields(intake: IntakeFlat): MissingFieldItem[] {
  const treatmentPresent =
    isIntakeFilled(intake.hospital) ||
    isIntakeFilled(intake.treating_doctor) ||
    intake.ems === true;
  const insurancePresent =
    isIntakeFilled(intake.client_insurance) ||
    isIntakeFilled(intake.third_party_insurance) ||
    isIntakeFilled(intake.health_insurance);
  const locationPresent = Boolean(intakeLocationLine(intake));
  const policePresent =
    isIntakeFilled(intake.police_department) || isIntakeFilled(intake.police_report_no);

  return MISSING_FIELD_DEFS.filter((item) => {
    if (item.key === "treating_doctor") {
      // Covered by the single "treatment" gap row when nothing is recorded.
      if (!treatmentPresent) return false;
      return !isIntakeFilled(intake.treating_doctor);
    }
    if (item.key === "hospital") {
      return !treatmentPresent;
    }
    if (item.key === "client_insurance" || item.key === "third_party_insurance") {
      if (item.key === "third_party_insurance" && insurancePresent) return false;
      if (item.key === "client_insurance" && insurancePresent) return false;
      return !insurancePresent;
    }
    if (item.key === "accident_location") return !locationPresent;
    if (item.key === "police_report_no") return !policePresent;
    return !isIntakeFilled(intake[item.key]);
  });
}

export function getNeedsReviewItems(intake: IntakeFlat): string[] {
  const out: string[] = [];
  const treatmentPresent =
    isIntakeFilled(intake.hospital) ||
    isIntakeFilled(intake.treating_doctor) ||
    intake.ems === true;
  if (!isIntakeFilled(intake.accident_date)) out.push("Accident date missing");
  if (!intakeLocationLine(intake)) out.push("Accident location incomplete");
  if (!isIntakeFilled(intake.injury_types)) out.push("Injury details incomplete");
  if (!treatmentPresent) out.push("Treatment not recorded");
  if (
    !isIntakeFilled(intake.client_insurance) &&
    !isIntakeFilled(intake.third_party_insurance) &&
    !isIntakeFilled(intake.health_insurance)
  ) {
    out.push("Insurance information missing");
  }
  if (!isIntakeFilled(intake.police_department) && !isIntakeFilled(intake.police_report_no)) {
    out.push("Police / incident report unknown");
  }
  if (!isIntakeFilled(intake.representation_date)) {
    out.push("Representation status unknown");
  }
  return out;
}

export type DetailSectionField = {
  key: keyof IntakeFlat;
  label: string;
  multiline?: boolean;
};

export type DetailSectionConfig = {
  id: string;
  title: string;
  critical?: boolean;
  fields: DetailSectionField[];
};

/** Config-driven detail sections for the review workspace. */
export const INTAKE_DETAIL_SECTIONS: DetailSectionConfig[] = [
  {
    id: "client",
    title: "Client",
    critical: true,
    fields: [
      { key: "name", label: "Name" },
      { key: "phone", label: "Phone" },
      { key: "email", label: "Email" },
      { key: "address", label: "Address" },
      { key: "dob", label: "Date of birth" },
      { key: "sex", label: "Sex" },
      { key: "dl_number", label: "Driver license #" },
      { key: "spouse_name", label: "Spouse" },
      { key: "emergency_contact", label: "Emergency contact" },
      { key: "passengers", label: "Passengers" },
    ],
  },
  {
    id: "incident",
    title: "Incident",
    critical: true,
    fields: [
      { key: "accident_date", label: "Accident date" },
      { key: "accident_time", label: "Accident time" },
      { key: "accident_location", label: "Location" },
      { key: "city", label: "City" },
      { key: "county", label: "County" },
      { key: "accident_description", label: "Full description", multiline: true },
      { key: "police_department", label: "Police department" },
      { key: "police_report_no", label: "Police report #" },
      { key: "ticket_issued", label: "Ticket issued" },
      { key: "ticket_who", label: "Ticket issued to" },
      { key: "ticket_reason", label: "Ticket reason" },
    ],
  },
  {
    id: "injuries",
    title: "Injuries and treatment",
    critical: true,
    fields: [
      { key: "injury_types", label: "Injury types" },
      { key: "ems", label: "EMS" },
      { key: "hospital", label: "Hospital" },
      { key: "hospital_bill", label: "Hospital bill" },
      { key: "treating_doctor", label: "Treating doctor" },
      { key: "health_insurance", label: "Health insurance" },
      { key: "medicaid", label: "Medicaid" },
      { key: "medicare", label: "Medicare" },
    ],
  },
  {
    id: "employment",
    title: "Employment",
    fields: [
      { key: "employer", label: "Employer" },
      { key: "job_description", label: "Job description" },
      { key: "salary_rate", label: "Salary / rate" },
      { key: "missed_work", label: "Missed work" },
    ],
  },
  {
    id: "insurance",
    title: "Insurance and representation",
    critical: true,
    fields: [
      { key: "representation_date", label: "Representation date" },
      { key: "client_insurance", label: "Client insurance" },
      { key: "client_policy_no", label: "Client policy #" },
      { key: "client_claim_no", label: "Client claim #" },
      { key: "third_party_insurance", label: "Third-party insurance" },
      { key: "third_party_policy_no", label: "Third-party policy #" },
      { key: "third_party_claim_no", label: "Third-party claim #" },
      { key: "pip", label: "PIP" },
      { key: "med_pay", label: "Med pay" },
      { key: "um_uim", label: "UM/UIM" },
    ],
  },
  {
    id: "property",
    title: "Vehicle and property damage",
    fields: [
      { key: "vehicle", label: "Vehicle" },
      { key: "vehicle_owner", label: "Owner" },
      { key: "drivable", label: "Drivable" },
      { key: "towed", label: "Towed" },
      { key: "towed_by", label: "Towed by" },
      { key: "vehicle_location", label: "Vehicle location" },
      { key: "has_loan", label: "Has loan" },
      { key: "lienholder", label: "Lienholder" },
      { key: "rental_needed", label: "Rental needed" },
      { key: "body_shop", label: "Body shop" },
    ],
  },
  {
    id: "referral",
    title: "Referral and marketing",
    fields: [
      { key: "how_found", label: "Source / referral" },
      { key: "map_location", label: "Map / location" },
    ],
  },
  {
    id: "other_parties",
    title: "Other parties",
    fields: [
      { key: "other_driver_name", label: "Other driver name" },
      { key: "other_driver_phone", label: "Phone" },
      { key: "other_driver_dob", label: "Date of birth" },
      { key: "other_driver_address", label: "Address" },
      { key: "other_driver_dl", label: "Driver license #" },
      { key: "other_driver_car_owner", label: "Car owner" },
    ],
  },
];

export function sectionIdForField(key: keyof IntakeFlat): string | null {
  for (const section of INTAKE_DETAIL_SECTIONS) {
    if (section.fields.some((f) => f.key === key)) return section.id;
  }
  if (key === "notes") return "notes";
  return null;
}

export function sectionHasAnyValue(intake: IntakeFlat, section: DetailSectionConfig): boolean {
  return section.fields.some((f) => isIntakeFilled(intake[f.key]));
}

export function transcriptLineCount(transcript: string | null | undefined): number {
  if (!transcript?.trim()) return 0;
  return transcript.split(/\r?\n/).filter((l) => l.trim()).length;
}
