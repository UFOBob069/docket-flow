import type { IntakeFlat } from "@/lib/intake-types";

/** Plain columns on `public.intakes` that staff / router may edit (excludes id, call_id, created_at, case_id). */
export const INTAKE_EDITABLE_COLUMNS = [
  "name",
  "phone",
  "accident_date",
  "quo_link",
  "transcript",
  "how_found",
  "map_location",
  "accident_time",
  "representation_date",
  "accident_location",
  "city",
  "county",
  "accident_description",
  "police_department",
  "police_report_no",
  "ticket_issued",
  "ticket_who",
  "ticket_reason",
  "email",
  "address",
  "dob",
  "sex",
  "dl_number",
  "spouse_name",
  "emergency_contact",
  "passengers",
  "vehicle",
  "vehicle_owner",
  "drivable",
  "towed",
  "towed_by",
  "vehicle_location",
  "has_loan",
  "lienholder",
  "rental_needed",
  "body_shop",
  "employer",
  "job_description",
  "missed_work",
  "salary_rate",
  "other_driver_name",
  "other_driver_phone",
  "other_driver_dob",
  "other_driver_address",
  "other_driver_dl",
  "other_driver_car_owner",
  "client_insurance",
  "client_policy_no",
  "client_claim_no",
  "third_party_insurance",
  "third_party_policy_no",
  "third_party_claim_no",
  "pip",
  "med_pay",
  "um_uim",
  "ems",
  "hospital_bill",
  "hospital",
  "treating_doctor",
  "injury_types",
  "medicaid",
  "medicare",
  "health_insurance",
  "notes",
] as const satisfies readonly (keyof IntakeFlat)[];

export type IntakeEditableColumn = (typeof INTAKE_EDITABLE_COLUMNS)[number];

const EDITABLE_SET = new Set<string>(INTAKE_EDITABLE_COLUMNS);

const BOOL_COLUMNS = new Set<string>([
  "ticket_issued",
  "drivable",
  "towed",
  "has_loan",
  "rental_needed",
  "missed_work",
  "pip",
  "med_pay",
  "um_uim",
  "ems",
  "hospital_bill",
  "medicaid",
  "medicare",
]);

/** Paths in legacy `data` jsonb → flat column (for reading old rows until backfilled). */
const LEGACY_DATA_PATH: Partial<Record<IntakeEditableColumn, [string, string] | "notes_root">> = {
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

function legacyValue(
  data: Record<string, unknown> | null | undefined,
  col: IntakeEditableColumn
): unknown {
  if (!data) return null;
  const path = LEGACY_DATA_PATH[col];
  if (!path) return null;
  if (path === "notes_root") return data.notes ?? null;
  const [section, key] = path;
  const sec = data[section] as Record<string, unknown> | undefined;
  if (!sec) return null;
  const v = sec[key];
  if (Array.isArray(v)) return v.map(String).join(", ");
  return v ?? null;
}

function coerceBool(v: unknown): boolean | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "boolean") return v;
  if (v === "true" || v === true) return true;
  if (v === "false" || v === false) return false;
  return null;
}

/** Map a raw `intakes` row (plain cols + optional legacy `data`) into IntakeFlat. */
export function intakeFromIntakesRow(r: Record<string, unknown>): IntakeFlat {
  const legacy = (r.data as Record<string, unknown> | null) ?? null;
  const out: Record<string, unknown> = {
    id: r.id,
    call_id: r.call_id ?? null,
    created_at: r.created_at ?? null,
    case_id: r.case_id ?? null,
  };

  for (const col of INTAKE_EDITABLE_COLUMNS) {
    let v = r[col];
    if (v === null || v === undefined || v === "") {
      v = legacyValue(legacy, col);
    }
    if (BOOL_COLUMNS.has(col)) {
      out[col] = coerceBool(v);
    } else if (v === null || v === undefined) {
      out[col] = null;
    } else {
      out[col] = typeof v === "string" ? v : String(v);
    }
  }

  return out as IntakeFlat;
}

/** Build a plain-column UPDATE payload (never writes nested `data`). */
export function buildIntakePlainColumnUpdate(patch: Partial<IntakeFlat>): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(patch)) {
    if (!EDITABLE_SET.has(key)) continue;
    if (BOOL_COLUMNS.has(key)) {
      if (value === "" || value === undefined) row[key] = null;
      else row[key] = coerceBool(value);
    } else if (value === "") {
      row[key] = null;
    } else {
      row[key] = value ?? null;
    }
  }
  return row;
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
