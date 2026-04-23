import type { EventCategory, EventKind } from "./types";
import {
  CASE_EVENT_KIND_SECTIONS,
  categoryForEventKind,
} from "./case-event-kinds";

export type ManualEventKindGroup = {
  topic: string;
  options: { value: EventKind; label: string }[];
};

function sectionToGroup(sec: (typeof CASE_EVENT_KIND_SECTIONS)[number]): ManualEventKindGroup {
  return {
    topic: sec.title,
    options: sec.kinds.map((k) => ({ value: k.value, label: k.label })),
  };
}

/** Full taxonomy for dropdowns (same order as progressive picker). */
export const MANUAL_EVENT_KIND_GROUPS: ManualEventKindGroup[] =
  CASE_EVENT_KIND_SECTIONS.map(sectionToGroup);

export const DEFAULT_MANUAL_EVENT_KIND: EventKind = CASE_EVENT_KIND_SECTIONS[0]!.kinds[0]!.value;

const SYSTEM_EVENT_KIND_OPTIONS: { value: EventKind; label: string }[] = [
  { value: "sol", label: "SOL" },
  { value: "sol_milestone", label: "SOL lead-up" },
  { value: "aso_dco", label: "Imported scheduling order" },
];

const LEGACY_EVENT_KIND_OPTIONS: { value: EventKind; label: string }[] = [
  { value: "hearing", label: "Hearing (legacy)" },
  { value: "trial", label: "Trial (legacy)" },
  { value: "mediation", label: "Mediation (legacy)" },
  { value: "deposition", label: "Deposition (legacy)" },
  { value: "court_appearance", label: "Court appearance (legacy)" },
  { value: "filing_deadline", label: "Filing deadline (legacy)" },
  { value: "discovery_deadline", label: "Discovery deadline (legacy)" },
  { value: "demand_response", label: "Demand response (legacy)" },
  { value: "document_review", label: "Document review (legacy)" },
  { value: "depo_prep", label: "Depo prep (legacy)" },
  { value: "mediation_prep", label: "Mediation prep (legacy)" },
  { value: "trial_prep", label: "Trial prep (legacy)" },
  { value: "trial_deposition", label: "Trial deposition (legacy)" },
  { value: "client_call", label: "Client call (legacy)" },
];

/** Edit-event dropdown: taxonomy + system + legacy. */
export const ALL_EVENT_KIND_SELECT_GROUPS: ManualEventKindGroup[] = [
  ...MANUAL_EVENT_KIND_GROUPS,
  { topic: "Imported / system", options: SYSTEM_EVENT_KIND_OPTIONS },
  { topic: "Legacy", options: LEGACY_EVENT_KIND_OPTIONS },
];

function buildEventKindLabels(): Record<EventKind, string> {
  const labels = {} as Record<string, string>;
  for (const s of CASE_EVENT_KIND_SECTIONS) {
    for (const k of s.kinds) labels[k.value] = k.label;
  }
  const extra: Partial<Record<EventKind, string>> = {
    sol: "SOL",
    sol_milestone: "SOL lead-up",
    aso_dco: "Imported scheduling order",
    hearing: "Hearing (legacy)",
    trial: "Trial (legacy)",
    mediation: "Mediation (legacy)",
    deposition: "Deposition (legacy)",
    court_appearance: "Court appearance (legacy)",
    filing_deadline: "Filing deadline (legacy)",
    discovery_deadline: "Discovery deadline (legacy)",
    demand_response: "Demand response (legacy)",
    document_review: "Document review (legacy)",
    depo_prep: "Depo prep (legacy)",
    mediation_prep: "Mediation prep (legacy)",
    trial_prep: "Trial prep (legacy)",
    trial_deposition: "Trial deposition (legacy)",
    client_call: "Client call (legacy)",
  };
  return { ...labels, ...extra } as Record<EventKind, string>;
}

export const EVENT_KIND_LABELS: Record<EventKind, string> = buildEventKindLabels();

/** Filter dropdowns: all kinds, sorted by label; `value: ""` means no filter. */
export const EVENT_KIND_FILTER_OPTIONS: { value: string; label: string }[] = (() => {
  const rest = (Object.keys(EVENT_KIND_LABELS) as EventKind[])
    .map((value) => ({ value, label: EVENT_KIND_LABELS[value] }))
    .sort((a, b) => a.label.localeCompare(b.label));
  return [{ value: "", label: "All event types" }, ...rest];
})();

export function eventKindDisplayLabel(kind: EventKind | undefined): string | null {
  if (!kind || kind === "other_event") return null;
  return EVENT_KIND_LABELS[kind] ?? null;
}

export function categoryForManualEventKind(kind: EventKind): EventCategory {
  return categoryForEventKind(kind);
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
    case "mediation_session":
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
    case "trial_date":
      return d ? `Trial — ${d}` : label;
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
