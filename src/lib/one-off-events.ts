import type { EventCategory, EventKind } from "./types";

export type ManualEventKindGroup = {
  topic: string;
  options: { value: EventKind; label: string }[];
};

/** Add-event picker: topics and subtopics (no SOL / ASO / system-only kinds). */
export const MANUAL_EVENT_KIND_GROUPS: ManualEventKindGroup[] = [
  {
    topic: "Court / Legal Events",
    options: [
      { value: "hearing", label: "Hearing" },
      { value: "trial", label: "Trial" },
      { value: "mediation", label: "Mediation" },
      { value: "deposition", label: "Deposition" },
      { value: "court_appearance", label: "Court Appearance" },
    ],
  },
  {
    topic: "Deadlines",
    options: [
      { value: "filing_deadline", label: "Filing Deadline" },
      { value: "discovery_deadline", label: "Discovery Deadline" },
      { value: "demand_response", label: "Demand Response" },
    ],
  },
  {
    topic: "Client / Communication",
    options: [{ value: "client_meeting", label: "Client Meeting" }],
  },
  {
    topic: "Internal Work",
    options: [
      { value: "attorney_review", label: "Attorney Review" },
      { value: "case_strategy", label: "Case Strategy" },
      { value: "internal_meeting", label: "Internal Meeting" },
      { value: "document_review", label: "Document Review" },
    ],
  },
  {
    topic: "Prep",
    options: [
      { value: "depo_prep", label: "Depo Prep" },
      { value: "mediation_prep", label: "Mediation Prep" },
      { value: "trial_prep", label: "Trial Prep" },
    ],
  },
  {
    topic: "Other",
    options: [{ value: "other_event", label: "Other" }],
  },
];

export const DEFAULT_MANUAL_EVENT_KIND: EventKind =
  MANUAL_EVENT_KIND_GROUPS[0]!.options[0]!.value;

const SYSTEM_EVENT_KIND_OPTIONS: { value: EventKind; label: string }[] = [
  { value: "sol", label: "SOL" },
  { value: "sol_milestone", label: "SOL lead-up" },
  { value: "aso_dco", label: "ASO / DCO" },
];

const LEGACY_EVENT_KIND_OPTIONS: { value: EventKind; label: string }[] = [
  { value: "trial_deposition", label: "Trial deposition (legacy)" },
  { value: "client_call", label: "Client call (legacy)" },
];

/** Edit-event dropdown: manual groups + system + legacy. */
export const ALL_EVENT_KIND_SELECT_GROUPS: ManualEventKindGroup[] = [
  ...MANUAL_EVENT_KIND_GROUPS,
  { topic: "Imported / system", options: SYSTEM_EVENT_KIND_OPTIONS },
  { topic: "Legacy", options: LEGACY_EVENT_KIND_OPTIONS },
];

export const EVENT_KIND_LABELS: Record<EventKind, string> = {
  sol: "SOL",
  sol_milestone: "SOL lead-up",
  aso_dco: "ASO / DCO",
  hearing: "Hearing",
  trial: "Trial",
  mediation: "Mediation",
  deposition: "Deposition",
  court_appearance: "Court Appearance",
  filing_deadline: "Filing Deadline",
  discovery_deadline: "Discovery Deadline",
  demand_response: "Demand Response",
  client_meeting: "Client Meeting",
  attorney_review: "Attorney Review",
  case_strategy: "Case Strategy",
  internal_meeting: "Internal Meeting",
  document_review: "Document Review",
  depo_prep: "Depo Prep",
  mediation_prep: "Mediation Prep",
  trial_prep: "Trial Prep",
  other_event: "Other",
  trial_deposition: "Trial deposition (legacy)",
  client_call: "Client call (legacy)",
};

export function eventKindDisplayLabel(kind: EventKind | undefined): string | null {
  if (!kind || kind === "other_event") return null;
  return EVENT_KIND_LABELS[kind] ?? null;
}

export function categoryForManualEventKind(kind: EventKind): EventCategory {
  switch (kind) {
    case "trial":
    case "trial_deposition":
      return "trial";
    case "mediation":
    case "mediation_prep":
      return "mediation";
    case "deposition":
    case "depo_prep":
    case "trial_prep":
      return "discovery";
    case "hearing":
    case "court_appearance":
      return "pretrial";
    case "filing_deadline":
    case "discovery_deadline":
    case "demand_response":
      return "motions";
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

export function suggestedTitleForManualEvent(kind: EventKind, deponentOrSubject: string): string {
  const d = deponentOrSubject.trim();
  const label = EVENT_KIND_LABELS[kind] ?? "Event";
  switch (kind) {
    case "deposition":
    case "trial_deposition":
      return d ? `Deposition — ${d}` : "Deposition";
    case "depo_prep":
      return d ? `Depo prep — ${d}` : "Depo prep";
    case "mediation":
      return d ? `Mediation — ${d}` : "Mediation";
    case "mediation_prep":
      return d ? `Mediation prep — ${d}` : "Mediation prep";
    case "trial_prep":
      return d ? `Trial prep — ${d}` : "Trial prep";
    case "client_call":
    case "client_meeting":
      return d ? `Client meeting — ${d}` : "Client meeting";
    case "hearing":
      return d ? `Hearing — ${d}` : "Hearing";
    case "trial":
      return d ? `Trial — ${d}` : "Trial";
    case "court_appearance":
      return d ? `Court appearance — ${d}` : "Court appearance";
    default:
      return d ? `${label} — ${d}` : label;
  }
}

export function manualEventNeedsDeponentField(kind: EventKind): boolean {
  return (
    kind === "deposition" ||
    kind === "trial_deposition" ||
    kind === "depo_prep" ||
    kind === "trial_prep"
  );
}
