import { DEFAULT_REMINDERS } from "./reminder-presets";
import type { EventCategory, EventKind } from "./types";

export type CaseEventKindOption = {
  value: EventKind;
  label: string;
  /** Reminder offsets before the event (minutes). Google Calendar keeps up to 4 weeks per popup; longer values are stored and shown here. */
  remindersMinutes: number[];
};

export type CaseEventKindSection = {
  id: string;
  title: string;
  kinds: CaseEventKindOption[];
};

/** Progressive picker + fixed reminder schedules (not user-editable). */
export const CASE_EVENT_KIND_SECTIONS: CaseEventKindSection[] = [
  {
    id: "milestones",
    title: "1. Case milestones",
    kinds: [
      { value: "milestone_answer_deadline", label: "Answer deadline", remindersMinutes: [10080, 4320, 1440] },
      {
        value: "milestone_plaintiff_initial_disclosures",
        label: "Plaintiff's initial disclosures",
        remindersMinutes: [20160, 10080],
      },
      {
        value: "milestone_defendant_initial_disclosures",
        label: "Defendant's initial disclosures",
        remindersMinutes: [20160, 10080],
      },
      { value: "milestone_scheduling_order", label: "Scheduling order", remindersMinutes: [20160, 10080] },
    ],
  },
  {
    id: "pleadings",
    title: "2. Pleadings",
    kinds: [
      {
        value: "pleadings_amended_deadline",
        label: "Amended pleadings deadline",
        remindersMinutes: [43200, 20160, 10080],
      },
    ],
  },
  {
    id: "medical",
    title: "3. Medical / Ch. 18",
    kinds: [
      { value: "medical_affidavit_18_001", label: "18.001 affidavit", remindersMinutes: [86400, 43200, 20160, 10080] },
      { value: "medical_counter_affidavit", label: "Counter-affidavit", remindersMinutes: [20160, 10080, 4320] },
    ],
  },
  {
    id: "discovery",
    title: "4. Discovery",
    kinds: [
      {
        value: "discovery_written_requests_sent",
        label: "Written discovery requests sent",
        remindersMinutes: [43200, 20160, 10080],
      },
      { value: "discovery_response_deadline", label: "Discovery response deadline", remindersMinutes: [20160, 10080] },
      {
        value: "discovery_completion_deadline",
        label: "Discovery completion deadline",
        remindersMinutes: [86400, 43200, 20160, 10080],
      },
      { value: "discovery_motion_to_compel", label: "Motion to compel", remindersMinutes: [20160, 10080] },
      { value: "discovery_supplementation", label: "Supplementation", remindersMinutes: [20160, 10080] },
    ],
  },
  {
    id: "experts",
    title: "5. Expert designations & challenges",
    kinds: [
      {
        value: "expert_plaintiff_designation",
        label: "Plaintiff's expert designation",
        remindersMinutes: [86400, 43200, 20160, 10080],
      },
      {
        value: "expert_defendant_designation",
        label: "Defendant's expert designation",
        remindersMinutes: [86400, 43200, 20160, 10080],
      },
      {
        value: "expert_rebuttal_designation",
        label: "Rebuttal expert designation",
        remindersMinutes: [43200, 20160, 10080],
      },
      {
        value: "expert_deposition_deadline",
        label: "Expert deposition deadline",
        remindersMinutes: [43200, 20160, 10080],
      },
      {
        value: "expert_challenges",
        label: "Challenges to expert witnesses",
        remindersMinutes: [43200, 20160, 10080],
      },
    ],
  },
  {
    id: "dispositive",
    title: "6. Dispositive motions",
    kinds: [
      { value: "dispositive_msj", label: "MSJ / dispositive motions", remindersMinutes: [86400, 43200, 20160, 10080] },
      { value: "dispositive_msj_response", label: "MSJ response", remindersMinutes: [20160, 10080, 4320] },
      { value: "dispositive_msj_reply", label: "MSJ reply", remindersMinutes: [10080, 4320] },
      { value: "dispositive_msj_hearing", label: "MSJ hearing", remindersMinutes: [20160, 10080, 2880] },
    ],
  },
  {
    id: "mediation",
    title: "7. Mediation & settlement",
    kinds: [
      {
        value: "mediation_completion",
        label: "Mediation completion",
        remindersMinutes: [86400, 43200, 20160, 10080],
      },
      { value: "mediation_session", label: "Mediation", remindersMinutes: [20160, 10080, 2880] },
    ],
  },
  {
    id: "pretrial_filings",
    title: "8. Pre-trial filings",
    kinds: [
      {
        value: "pretrial_witness_list_exchange",
        label: "Witness list exchange",
        remindersMinutes: [43200, 20160, 10080],
      },
      {
        value: "pretrial_exhibit_list_exchange",
        label: "Exhibit list exchange",
        remindersMinutes: [43200, 20160, 10080],
      },
      { value: "pretrial_motions_limine", label: "Motions in limine", remindersMinutes: [20160, 10080, 4320] },
      { value: "pretrial_jury_charge", label: "Proposed jury charge", remindersMinutes: [20160, 10080, 4320] },
      {
        value: "pretrial_dep_page_line_designations",
        label: "Deposition page/line designations",
        remindersMinutes: [20160, 10080, 4320],
      },
      {
        value: "pretrial_cross_designations_objections",
        label: "Cross-designations & written objections",
        remindersMinutes: [10080, 4320],
      },
      {
        value: "pretrial_written_statement_objections",
        label: "Written statement of objections",
        remindersMinutes: [10080, 4320],
      },
      {
        value: "pretrial_electronic_evidence_notice",
        label: "Notice of intent to use electronic presentation of evidence",
        remindersMinutes: [10080, 4320],
      },
      {
        value: "pretrial_mil_good_faith_conference",
        label: "Good faith conference to resolve objections / MIL",
        remindersMinutes: [10080, 4320],
      },
    ],
  },
  {
    id: "pretrial_trial",
    title: "9. Pre-trial & trial",
    kinds: [
      { value: "pretrial_conference", label: "Pre-trial conference", remindersMinutes: [20160, 10080, 2880] },
      {
        value: "trial_date",
        label: "Trial date",
        remindersMinutes: [172800, 129600, 86400, 43200, 20160, 10080, 2880],
      },
    ],
  },
  {
    id: "internal",
    title: "10. Internal / client",
    kinds: [
      { value: "client_meeting", label: "Client meeting", remindersMinutes: [20160, 10080] },
      { value: "attorney_review", label: "Attorney review", remindersMinutes: [20160, 10080] },
      { value: "case_strategy", label: "Strategy", remindersMinutes: [20160, 10080] },
      { value: "internal_meeting", label: "Internal meeting", remindersMinutes: [20160, 10080] },
    ],
  },
  {
    id: "other",
    title: "11. Other",
    kinds: [{ value: "other_event", label: "Other", remindersMinutes: [20160, 10080] }],
  },
];

const TAXONOMY_REMINDERS = new Map<EventKind, number[]>();
for (const sec of CASE_EVENT_KIND_SECTIONS) {
  for (const k of sec.kinds) {
    TAXONOMY_REMINDERS.set(k.value, k.remindersMinutes);
  }
}

/** First kind in the taxonomy (default for new events). */
export const DEFAULT_CASE_EVENT_KIND: EventKind = CASE_EVENT_KIND_SECTIONS[0]!.kinds[0]!.value;

export function isTaxonomyEventKind(kind: EventKind): boolean {
  return TAXONOMY_REMINDERS.has(kind);
}

export function getFixedRemindersForKind(kind: EventKind): number[] {
  const fixed = TAXONOMY_REMINDERS.get(kind);
  if (fixed) return [...fixed];
  return [];
}

/** Taxonomy kinds use fixed minutes; other kinds use category default presets. */
export function getRemindersForEventKind(kind: EventKind): number[] {
  const fixed = TAXONOMY_REMINDERS.get(kind);
  if (fixed) return [...fixed];
  const cat = categoryForEventKind(kind);
  return [...DEFAULT_REMINDERS[cat]];
}

export function findSectionForKind(kind: EventKind): CaseEventKindSection | undefined {
  return CASE_EVENT_KIND_SECTIONS.find((s) => s.kinds.some((k) => k.value === kind));
}

/** Maps taxonomy + legacy kinds to calendar category (badges / defaults). */
export function categoryForEventKind(kind: EventKind): EventCategory {
  switch (kind) {
    case "trial_date":
    case "pretrial_conference":
    case "pretrial_motions_limine":
    case "pretrial_jury_charge":
    case "pretrial_dep_page_line_designations":
    case "pretrial_cross_designations_objections":
    case "pretrial_written_statement_objections":
    case "pretrial_electronic_evidence_notice":
    case "pretrial_mil_good_faith_conference":
    case "pretrial_witness_list_exchange":
    case "pretrial_exhibit_list_exchange":
    case "hearing":
    case "court_appearance":
      return "pretrial";
    case "trial":
    case "trial_prep":
    case "trial_deposition":
      return "trial";
    case "mediation":
    case "mediation_prep":
    case "mediation_session":
    case "mediation_completion":
      return "mediation";
    case "deposition":
    case "depo_prep":
    case "expert_deposition_deadline":
    case "discovery_written_requests_sent":
    case "discovery_response_deadline":
    case "discovery_completion_deadline":
    case "discovery_motion_to_compel":
    case "discovery_supplementation":
      return "discovery";
    case "milestone_answer_deadline":
    case "pleadings_amended_deadline":
    case "filing_deadline":
    case "discovery_deadline":
    case "demand_response":
    case "dispositive_msj":
    case "dispositive_msj_response":
    case "dispositive_msj_reply":
    case "dispositive_msj_hearing":
      return "motions";
    case "expert_plaintiff_designation":
    case "expert_defendant_designation":
    case "expert_rebuttal_designation":
    case "expert_challenges":
      return "experts";
    case "milestone_plaintiff_initial_disclosures":
    case "milestone_defendant_initial_disclosures":
    case "milestone_scheduling_order":
    case "medical_affidavit_18_001":
    case "medical_counter_affidavit":
    case "sol":
    case "sol_milestone":
    case "aso_dco":
    case "client_meeting":
    case "client_call":
    case "attorney_review":
    case "case_strategy":
    case "internal_meeting":
    case "document_review":
    case "other_event":
    default:
      return "other";
  }
}
