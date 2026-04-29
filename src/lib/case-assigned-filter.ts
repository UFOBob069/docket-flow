import type { Contact } from "./types";

/** Any selected id must be assigned on the case with the given contact role (OR semantics). */
export function caseMatchesAssignedRole(
  c: { assignedContactIds: string[] },
  selectedIds: string[],
  role: "attorney" | "paralegal",
  contactById: Map<string, Contact>
): boolean {
  if (!selectedIds.length) return true;
  return selectedIds.some(
    (id) => c.assignedContactIds.includes(id) && contactById.get(id)?.role === role
  );
}
