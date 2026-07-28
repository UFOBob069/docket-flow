/** Row shape from `public.intakes_flat` (read) + `case_id` from base table when joined. */
export type IntakeFlat = {
  id: string;
  call_id: string | null;
  name: string | null;
  phone: string | null;
  accident_date: string | null;
  quo_link: string | null;
  transcript: string | null;
  created_at: string | null;
  case_id?: string | null;

  how_found: string | null;
  map_location: string | null;

  accident_time: string | null;
  representation_date: string | null;
  accident_location: string | null;
  city: string | null;
  county: string | null;
  accident_description: string | null;
  police_department: string | null;
  police_report_no: string | null;
  ticket_issued: boolean | null;
  ticket_who: string | null;
  ticket_reason: string | null;

  email: string | null;
  address: string | null;
  dob: string | null;
  sex: string | null;
  dl_number: string | null;
  spouse_name: string | null;
  emergency_contact: string | null;
  passengers: string | null;

  vehicle: string | null;
  vehicle_owner: string | null;
  drivable: boolean | null;
  towed: boolean | null;
  towed_by: string | null;
  vehicle_location: string | null;
  has_loan: boolean | null;
  lienholder: string | null;
  rental_needed: boolean | null;
  body_shop: string | null;

  employer: string | null;
  job_description: string | null;
  missed_work: boolean | null;
  salary_rate: string | null;

  other_driver_name: string | null;
  other_driver_phone: string | null;
  other_driver_dob: string | null;
  other_driver_address: string | null;
  other_driver_dl: string | null;
  other_driver_car_owner: string | null;

  client_insurance: string | null;
  client_policy_no: string | null;
  client_claim_no: string | null;
  third_party_insurance: string | null;
  third_party_policy_no: string | null;
  third_party_claim_no: string | null;
  pip: boolean | null;
  med_pay: boolean | null;
  um_uim: boolean | null;

  ems: boolean | null;
  hospital_bill: boolean | null;
  hospital: string | null;
  treating_doctor: string | null;
  injury_types: string | null;
  medicaid: boolean | null;
  medicare: boolean | null;
  health_insurance: string | null;

  notes: string | null;
};

export type IntakeInteraction = {
  id: string;
  intake_call_id: string;
  created_at: string | null;
  channel: string | null;
  direction: string | null;
  summary: string | null;
  body: string | null;
};

export type IntakeListItem = Pick<
  IntakeFlat,
  "id" | "call_id" | "name" | "phone" | "accident_date" | "created_at" | "case_id" | "how_found" | "notes"
>;

export type IntakePromoteBody = {
  caseNumber: string;
  responsibleAttorneyContactId: string;
  paralegalContactId: string;
  eventAttorneyContactId?: string | null;
  extraAssigneeIds?: string[];
  preferredLanguage: string;
  secondaryLanguage?: string | null;
  caseType: string;
  clientAlreadyInQuo?: "yes" | "no";
  clientPhone?: string;
  /** Override split from intake name */
  clientFirstName?: string;
  clientLastName?: string;
  dateOfBirth?: string;
  dateOfIncident?: string;
  notes?: string;
  injuries?: string;
  caseDescription?: string;
  solDate?: string;
  solRemindersMinutes?: number[];
};
