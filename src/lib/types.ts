export type CaseStatus = "active" | "archived";

export type EventCategory =
  | "trial"
  | "mediation"
  | "experts"
  | "motions"
  | "discovery"
  | "pretrial"
  | "other";

/**
 * Case-centric calendar kinds. Taxonomy lives in `case-event-kinds.ts` (fixed reminders per kind).
 * Legacy DB values are kept for older rows.
 */
export type EventKind =
  | "sol"
  | "sol_milestone"
  | "aso_dco"
  /* Taxonomy — case milestones */
  | "milestone_answer_deadline"
  | "milestone_plaintiff_initial_disclosures"
  | "milestone_defendant_initial_disclosures"
  | "milestone_scheduling_order"
  /* Pleadings */
  | "pleadings_amended_deadline"
  /* Medical / Ch. 18 */
  | "medical_affidavit_18_001"
  | "medical_counter_affidavit"
  /* Discovery */
  | "discovery_written_requests_sent"
  | "discovery_response_deadline"
  | "discovery_completion_deadline"
  | "discovery_motion_to_compel"
  | "discovery_supplementation"
  /* Experts */
  | "expert_plaintiff_designation"
  | "expert_defendant_designation"
  | "expert_rebuttal_designation"
  | "expert_deposition_deadline"
  | "expert_challenges"
  /* Dispositive */
  | "dispositive_msj"
  | "dispositive_msj_response"
  | "dispositive_msj_reply"
  | "dispositive_msj_hearing"
  /* Mediation */
  | "mediation_completion"
  | "mediation_session"
  /* Pre-trial filings */
  | "pretrial_witness_list_exchange"
  | "pretrial_exhibit_list_exchange"
  | "pretrial_motions_limine"
  | "pretrial_jury_charge"
  | "pretrial_dep_page_line_designations"
  | "pretrial_cross_designations_objections"
  | "pretrial_written_statement_objections"
  | "pretrial_electronic_evidence_notice"
  | "pretrial_mil_good_faith_conference"
  /* Pre-trial & trial */
  | "pretrial_conference"
  | "trial_date"
  /* Internal / client (shared labels with taxonomy) */
  | "client_meeting"
  | "attorney_review"
  | "case_strategy"
  | "internal_meeting"
  | "other_event"
  /* Legacy — court / prep / older manual kinds */
  | "hearing"
  | "trial"
  | "mediation"
  | "deposition"
  | "court_appearance"
  | "filing_deadline"
  | "discovery_deadline"
  | "demand_response"
  | "document_review"
  | "depo_prep"
  | "mediation_prep"
  | "trial_prep"
  | "trial_deposition"
  | "client_call";

export type ContactRole = "attorney" | "paralegal" | "legal_assistant" | "other";

export interface Contact {
  id: string;
  ownerId: string;
  name: string;
  email: string;
  role: ContactRole;
  createdAt: number;
  updatedAt: number;
}

export interface Case {
  id: string;
  ownerId: string;
  /** Short label — prefer {@link caseDisplayName} for UI */
  name: string;
  clientName: string;
  /** Firm case number (required on new cases) */
  caseNumber?: string | null;
  /** @deprecated use caseNumber; kept for legacy data */
  causeNumber?: string | null;
  court?: string | null;
  /** ISO date YYYY-MM-DD */
  dateOfIncident?: string | null;
  notes?: string | null;
  caseType?: string | null;
  status: CaseStatus;
  documentUrl?: string;
  documentFileName?: string;
  assignedContactIds: string[];
  createdAt: number;
  updatedAt: number;
}

export interface CalendarEvent {
  id: string;
  caseId: string;
  ownerId: string;
  title: string;
  /** Calendar day for sorting / all-day events (YYYY-MM-DD) */
  date: string;
  description: string;
  category: EventCategory;
  eventKind?: EventKind;
  /** Timed events (depositions, calls, etc.) — ISO datetime */
  startDateTime?: string | null;
  endDateTime?: string | null;
  /** Deposition: who is being deposed; other kinds: short subject label */
  deponentOrSubject?: string | null;
  /** Free text for external attendees / parties */
  externalAttendeesText?: string | null;
  /** Additional internal people beyond case-level assignees */
  extraInternalContactIds?: string[];
  zoomLink?: string | null;
  priority?: "high" | "medium" | "low";
  googleEventId?: string;
  /** Lowercased email → Google event id on that user's primary calendar */
  googleCalendarEventIdsByEmail?: Record<string, string>;
  /** When set, {@link googleEventId} lives on this shared calendar (SOL milestones), not primary */
  googleHostCalendarId?: string;
  included: boolean;
  /** When true, excluded from overdue / dashboard urgency and global calendar list. */
  completed: boolean;
  groupSuggested: boolean;
  groupId?: string;
  mergeWithSameGroup?: boolean;
  noiseFlag: boolean;
  noiseReason?: string;
  remindersMinutes: number[];
  emailRemindersSent?: number[];
  createdAt: number;
  updatedAt: number;
}

export type ActivityAction =
  | "case_created"
  | "case_archived"
  | "case_activated"
  | "case_deleted"
  | "event_created"
  | "event_edited"
  | "event_deleted"
  | "events_bulk_deleted"
  | "events_bulk_rescheduled"
  | "contacts_reassigned";

export interface ActivityEntry {
  id: string;
  caseId?: string;
  caseName?: string;
  action: ActivityAction;
  description: string;
  userEmail: string;
  createdAt: number;
}

export interface ExtractedDeadline {
  date: string;
  title: string;
  /** Model output: taxonomy EventKind (see case-event-kinds). */
  eventKind?: string;
  /** Legacy extracts only — ignored when eventKind is set. */
  category?: string;
  description: string;
  priority?: string;
}
