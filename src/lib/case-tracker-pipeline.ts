/** Case Tracker pipeline stage + disbursement (shared with Case Tracker app). */

export type CaseTrackerPipeline = {
  caseStage: string | null;
  disbursedStatus: string | null;
  checkDisbursedAt: string | null;
};

const CLOSED_STAGE_LABELS = new Set(["Disengaged", "Terminated", "Referred"]);

const STAGE_LABEL_BY_KEY: Record<string, string> = {
  intake: "Intake",
  treatment: "Treatment",
  demand: "Demand",
  litigation: "Litigation",
  lit: "Litigation",
  settlement: "Settlement",
  settled: "Settlement",
  disbursement: "Disbursement",
  closed: "Closed",
  disengaged: "Disengaged",
  terminated: "Terminated",
  referred: "Referred",
};

/** Normalize DB enum / spreadsheet variants to a display label. */
export function normalizeCaseStageLabel(raw: string | null | undefined): string | null {
  const trimmed = raw?.trim();
  if (!trimmed) return null;
  const key = trimmed.toLowerCase().replace(/[\s_-]+/g, "");
  return STAGE_LABEL_BY_KEY[key] ?? trimmed;
}

export function isDisbursed(
  result: Pick<CaseTrackerPipeline, "disbursedStatus" | "checkDisbursedAt"> | null | undefined
): boolean {
  if (!result) return false;
  if (result.disbursedStatus?.trim().toLowerCase() === "yes") return true;
  return Boolean(result.checkDisbursedAt?.trim());
}

export function isClosedTrackerStage(stage: string | null | undefined): boolean {
  const label = normalizeCaseStageLabel(stage);
  return label ? CLOSED_STAGE_LABELS.has(label) : false;
}

/** Matches Case Tracker active pipeline: not disbursed and not disengaged/terminated/referred. */
export function isTrackerPipelineClosed(
  pipeline: CaseTrackerPipeline | null | undefined
): boolean {
  if (!pipeline) return false;
  if (isDisbursed(pipeline)) return true;
  return isClosedTrackerStage(pipeline.caseStage);
}

export function isTrackerPipelineActive(
  pipeline: CaseTrackerPipeline | null | undefined
): boolean {
  return !isTrackerPipelineClosed(pipeline);
}

/** Ordered stages for filter UI (includes closed stages). */
export const CASE_STAGE_FILTER_OPTIONS: { id: string; label: string }[] = [
  { id: "Intake", label: "Intake" },
  { id: "Treatment", label: "Treatment" },
  { id: "Demand", label: "Demand" },
  { id: "Litigation", label: "Litigation" },
  { id: "Settlement", label: "Settlement" },
  { id: "Disbursement", label: "Disbursement" },
  { id: "Disengaged", label: "Disengaged" },
  { id: "Terminated", label: "Terminated" },
  { id: "Referred", label: "Referred" },
  { id: "Closed", label: "Closed" },
];

export function caseStageFilterLabel(
  pipeline: CaseTrackerPipeline | null | undefined
): string | null {
  return normalizeCaseStageLabel(pipeline?.caseStage ?? null);
}

export function caseMatchesStageFilters(
  pipeline: CaseTrackerPipeline | null | undefined,
  selectedStages: string[]
): boolean {
  if (!selectedStages.length) return true;
  const label = caseStageFilterLabel(pipeline);
  if (!label) return false;
  return selectedStages.includes(label);
}
