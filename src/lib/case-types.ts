/** Allowed case types for new cases (stored as display label in `cases.case_type`). */
export const CASE_TYPE_OPTIONS = [
  "Auto Accident",
  "Commercial / 18 Wheeler",
  "Dog Bite",
  "Pedestrian / Bicycle / Scooter",
  "Premises Liability",
  "Sexual Assault / Child Abuse",
  "Work Injury",
  "Wrongful Death",
  "Other Injury",
] as const;

export type CaseType = (typeof CASE_TYPE_OPTIONS)[number];

export function isCaseType(value: string): value is CaseType {
  return (CASE_TYPE_OPTIONS as readonly string[]).includes(value);
}
