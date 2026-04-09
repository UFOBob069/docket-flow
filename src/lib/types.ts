export type CaseStatus = "active" | "archived";

export type EventCategory =
  | "trial"
  | "mediation"
  | "experts"
  | "motions"
  | "discovery"
  | "pretrial"
  | "other";

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
  name: string;
  clientName: string;
  causeNumber?: string | null;
  court?: string | null;
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
  date: string;
  description: string;
  category: EventCategory;
  priority?: "high" | "medium" | "low";
  googleEventId?: string;
  included: boolean;
  /** Suggested merge with other same-day items */
  groupSuggested: boolean;
  /** Group id for UI merge (ephemeral until merged) */
  groupId?: string;
  /** When true with others sharing groupId, one Google event is created */
  mergeWithSameGroup?: boolean;
  noiseFlag: boolean;
  noiseReason?: string;
  remindersMinutes: number[];
  /** Tracks which email reminders have already been sent (minutes values) */
  emailRemindersSent?: number[];
  createdAt: number;
  updatedAt: number;
}

/** LLM raw row before smart processing */
export interface ExtractedDeadline {
  date: string;
  title: string;
  category: string;
  description: string;
  priority?: string;
}
