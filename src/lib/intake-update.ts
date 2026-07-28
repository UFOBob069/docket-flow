import type { IntakeFlat } from "@/lib/intake-types";

type JsonRecord = Record<string, unknown>;

/** Maps flat intake field keys to top-level column or nested `data` json path. */
const TOP_LEVEL_KEYS = new Set([
  "name",
  "phone",
  "accident_date",
  "quo_link",
  "transcript",
]);

const DATA_PATH: Partial<Record<keyof IntakeFlat, [string, string] | "notes_root">> = {
  how_found: ["referral", "how_found"],
  map_location: ["referral", "map_location"],
  accident_time: ["accident", "time"],
  representation_date: ["accident", "representation_date"],
  accident_location: ["accident", "location"],
  city: ["accident", "city"],
  county: ["accident", "county"],
  accident_description: ["accident", "description"],
  police_department: ["accident", "police_department"],
  police_report_no: ["accident", "police_report_no"],
  ticket_issued: ["accident", "ticket_issued"],
  ticket_who: ["accident", "ticket_who"],
  ticket_reason: ["accident", "ticket_reason"],
  email: ["client", "email"],
  address: ["client", "address"],
  dob: ["client", "dob"],
  sex: ["client", "sex"],
  dl_number: ["client", "dl_number"],
  spouse_name: ["client", "spouse_name"],
  emergency_contact: ["client", "emergency_contact"],
  passengers: ["client", "passengers"],
  vehicle: ["property_damage", "vehicle"],
  vehicle_owner: ["property_damage", "owner"],
  drivable: ["property_damage", "drivable"],
  towed: ["property_damage", "towed"],
  towed_by: ["property_damage", "towed_by"],
  vehicle_location: ["property_damage", "vehicle_location"],
  has_loan: ["property_damage", "has_loan"],
  lienholder: ["property_damage", "lienholder"],
  rental_needed: ["property_damage", "rental_needed"],
  body_shop: ["property_damage", "body_shop"],
  employer: ["employment", "employer"],
  job_description: ["employment", "job_description"],
  missed_work: ["employment", "missed_work"],
  salary_rate: ["employment", "salary_rate"],
  other_driver_name: ["other_driver", "name"],
  other_driver_phone: ["other_driver", "phone"],
  other_driver_dob: ["other_driver", "dob"],
  other_driver_address: ["other_driver", "address"],
  other_driver_dl: ["other_driver", "dl_number"],
  other_driver_car_owner: ["other_driver", "car_owner"],
  client_insurance: ["insurance", "client_company"],
  client_policy_no: ["insurance", "client_policy_number"],
  client_claim_no: ["insurance", "client_claim_number"],
  third_party_insurance: ["insurance", "third_party_company"],
  third_party_policy_no: ["insurance", "third_party_policy_number"],
  third_party_claim_no: ["insurance", "third_party_claim_number"],
  pip: ["insurance", "pip"],
  med_pay: ["insurance", "med_pay"],
  um_uim: ["insurance", "um_uim"],
  ems: ["injury", "ems"],
  hospital_bill: ["injury", "hospital_bill"],
  hospital: ["injury", "hospital"],
  treating_doctor: ["injury", "treating_doctor"],
  injury_types: ["injury", "injury_types"],
  medicaid: ["injury", "medicaid"],
  medicare: ["injury", "medicare"],
  health_insurance: ["injury", "health_insurance"],
  notes: "notes_root",
};

function setNested(obj: JsonRecord, section: string, key: string, value: unknown): void {
  const sec = (obj[section] as JsonRecord | undefined) ?? {};
  sec[key] = value;
  obj[section] = sec;
}

/** Merge editable flat fields into an intakes row update (`top` + `data` jsonb). */
export function buildIntakeRowUpdateFromPatch(
  patch: Partial<IntakeFlat>,
  existingData: JsonRecord | null
): { top: Record<string, unknown>; data: JsonRecord } {
  const top: Record<string, unknown> = {};
  const data: JsonRecord = { ...(existingData ?? {}) };

  for (const [key, value] of Object.entries(patch)) {
    if (key === "id" || key === "call_id" || key === "created_at" || key === "case_id") continue;
    const k = key as keyof IntakeFlat;
    if (TOP_LEVEL_KEYS.has(key)) {
      top[key] = value === "" ? null : value;
      continue;
    }
    const path = DATA_PATH[k];
    if (!path) continue;
    if (path === "notes_root") {
      data.notes = value === "" || value === null ? null : value;
      continue;
    }
    const [section, field] = path;
    if (typeof value === "boolean" || value === null) {
      setNested(data, section, field, value);
    } else if (value === "") {
      setNested(data, section, field, null);
    } else if (k === "passengers" || k === "injury_types") {
      const items = String(value)
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      setNested(data, section, field, items);
    } else {
      setNested(data, section, field, value);
    }
  }

  return { top, data };
}

export const INTAKE_FIELD_SECTIONS: {
  title: string;
  fields: { key: keyof IntakeFlat; label: string; multiline?: boolean }[];
}[] = [
  {
    title: "Contact",
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
    title: "Referral",
    fields: [
      { key: "how_found", label: "How found" },
      { key: "map_location", label: "Map / location" },
    ],
  },
  {
    title: "Accident",
    fields: [
      { key: "accident_date", label: "Accident date" },
      { key: "accident_time", label: "Accident time" },
      { key: "representation_date", label: "Representation date" },
      { key: "accident_location", label: "Location" },
      { key: "city", label: "City" },
      { key: "county", label: "County" },
      { key: "accident_description", label: "Description", multiline: true },
      { key: "police_department", label: "Police department" },
      { key: "police_report_no", label: "Police report #" },
      { key: "ticket_who", label: "Ticket issued to" },
      { key: "ticket_reason", label: "Ticket reason" },
    ],
  },
  {
    title: "Injury",
    fields: [
      { key: "injury_types", label: "Injury types" },
      { key: "hospital", label: "Hospital" },
      { key: "treating_doctor", label: "Treating doctor" },
      { key: "health_insurance", label: "Health insurance" },
    ],
  },
  {
    title: "Insurance",
    fields: [
      { key: "client_insurance", label: "Client insurance" },
      { key: "client_policy_no", label: "Client policy #" },
      { key: "client_claim_no", label: "Client claim #" },
      { key: "third_party_insurance", label: "Third-party insurance" },
      { key: "third_party_policy_no", label: "Third-party policy #" },
      { key: "third_party_claim_no", label: "Third-party claim #" },
    ],
  },
  {
    title: "Property damage",
    fields: [
      { key: "vehicle", label: "Vehicle" },
      { key: "vehicle_owner", label: "Owner" },
      { key: "towed_by", label: "Towed by" },
      { key: "vehicle_location", label: "Vehicle location" },
      { key: "lienholder", label: "Lienholder" },
      { key: "body_shop", label: "Body shop" },
    ],
  },
  {
    title: "Employment",
    fields: [
      { key: "employer", label: "Employer" },
      { key: "job_description", label: "Job description" },
      { key: "salary_rate", label: "Salary / rate" },
    ],
  },
  {
    title: "Other driver",
    fields: [
      { key: "other_driver_name", label: "Name" },
      { key: "other_driver_phone", label: "Phone" },
      { key: "other_driver_dob", label: "DOB" },
      { key: "other_driver_address", label: "Address" },
      { key: "other_driver_dl", label: "DL #" },
      { key: "other_driver_car_owner", label: "Car owner" },
    ],
  },
  {
    title: "Notes",
    fields: [{ key: "notes", label: "Notes", multiline: true }],
  },
];
