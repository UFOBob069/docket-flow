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

/** Older rows may still use these kinds; they are hidden from filters and new-event pickers. */
export const LEGACY_EVENT_KINDS: readonly EventKind[] = [
  "hearing",
  "trial",
  "mediation",
  "deposition",
  "court_appearance",
  "filing_deadline",
  "discovery_deadline",
  "demand_response",
  "document_review",
  "depo_prep",
  "mediation_prep",
  "trial_prep",
  "trial_deposition",
  "client_call",
] as const;

const LEGACY_KIND_SET = new Set<EventKind>(LEGACY_EVENT_KINDS);

export function isLegacyEventKind(kind: EventKind): boolean {
  return LEGACY_KIND_SET.has(kind);
}

/** Edit-event dropdown: taxonomy + system (no legacy menu). */
export const ALL_EVENT_KIND_SELECT_GROUPS: ManualEventKindGroup[] = [
  ...MANUAL_EVENT_KIND_GROUPS,
  { topic: "Imported / system", options: SYSTEM_EVENT_KIND_OPTIONS },
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
    hearing: "Hearing",
    trial: "Trial",
    mediation: "Mediation",
    deposition: "Deposition",
    court_appearance: "Court appearance",
    filing_deadline: "Filing deadline",
    discovery_deadline: "Discovery deadline",
    demand_response: "Demand response",
    document_review: "Document review",
    depo_prep: "Depo prep",
    mediation_prep: "Mediation prep",
    trial_prep: "Trial prep",
    trial_deposition: "Trial deposition",
    client_call: "Client call",
  };
  return { ...labels, ...extra } as Record<EventKind, string>;
}

export const EVENT_KIND_LABELS: Record<EventKind, string> = buildEventKindLabels();

/** If an existing event still has a legacy kind, show it once so the select value is valid. */
export function augmentKindGroupsForEdit(
  groups: ManualEventKindGroup[],
  currentKind: EventKind | undefined
): ManualEventKindGroup[] {
  if (!currentKind || !isLegacyEventKind(currentKind)) return groups;
  const present = groups.some((g) => g.options.some((o) => o.value === currentKind));
  if (present) return groups;
  return [
    ...groups,
    {
      topic: "Saved type (legacy)",
      options: [{ value: currentKind, label: EVENT_KIND_LABELS[currentKind] }],
    },
  ];
}

/** Filter dropdowns: non-legacy kinds only; `value: ""` means no filter. */
export const EVENT_KIND_FILTER_OPTIONS: { value: string; label: string }[] = (() => {
  const rest = (Object.keys(EVENT_KIND_LABELS) as EventKind[])
    .filter((k) => !LEGACY_KIND_SET.has(k))
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
    kind === "trial_prep" ||
    kind === "scheduling_deposition_deadline"
  );
}
