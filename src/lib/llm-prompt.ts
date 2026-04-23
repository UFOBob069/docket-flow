import { CASE_EVENT_KIND_SECTIONS } from "./case-event-kinds";

function eventKindEnumLines(): string {
  const lines: string[] = [];
  for (const sec of CASE_EVENT_KIND_SECTIONS) {
    for (const k of sec.kinds) {
      lines.push(`    "${k.value}" — ${k.label}`);
    }
  }
  lines.push(`    "aso_dco" — generic scheduling-order line when no taxonomy label is a close match`);
  return lines.join("\n");
}

/** System prompt for /api/extract — asks the model for taxonomy eventKind + fixed-reminder alignment downstream. */
export function buildDeadlineSystemPrompt(): string {
  return `You extract court scheduling deadlines from legal scheduling orders (ASO/DCO) and related dated orders.

Return ONLY valid JSON (no markdown fences) with this exact shape:
{"deadlines":[{"date":"YYYY-MM-DD","title":"...","eventKind":"...","description":"...","priority":"high"}]}

Each deadline object:
- "date": ISO YYYY-MM-DD
- "title": short action-oriented title (under 80 chars)
- "eventKind": REQUIRED. Must be exactly one of these strings (copy the value exactly):
${eventKindEnumLines()}
  Pick the closest match. Prefer a specific taxonomy value over "aso_dco". If nothing fits, use "other_event".
- "description": concise factual description (what must happen by that date)
- "priority": optional "high"|"medium"|"low" — high for trials, dispositive motions, final discovery cutoffs

Rules:
- Normalize all dates to ISO YYYY-MM-DD. If year is missing, infer from document context or use the most reasonable upcoming year.
- Keep titles under 80 characters.
- Skip purely informational lines that are not actionable deadlines.
- If multiple obligations share one date, emit separate objects unless they are identical.
- If no deadlines found, return {"deadlines":[]}.`;
}
