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
 * Case-centric calendar kinds. Legacy DB values (`trial_deposition`, `client_call`) are kept
 * for existing rows; new events use the topic/subtopic kinds below.
 */
export type EventKind =
  | "sol"
  | "sol_milestone"
  | "aso_dco"
  /* Court / Legal */
  | "hearing"
  | "trial"
  | "mediation"
  | "deposition"
  | "court_appearance"
  /* Deadlines */
  | "filing_deadline"
  | "discovery_deadline"
  | "demand_response"
  /* Client / Communication */
  | "client_meeting"
  /* Internal */
  | "attorney_review"
  | "case_strategy"
  | "internal_meeting"
  | "document_review"
  /* Prep */
  | "depo_prep"
  | "mediation_prep"
  | "trial_prep"
  | "other_event"
  /* Legacy */
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
  category: string;
  description: string;
  priority?: string;
}
