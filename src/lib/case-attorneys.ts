import type { CalendarEvent, Case, Contact } from "@/lib/types";

export function contactByIdMap(contacts: Contact[]): Map<string, Contact> {
  return new Map(contacts.map((c) => [c.id, c]));
}

/**
 * Primary case attorney. Uses `responsible_attorney_contact_id`, else first attorney in
 * `assigned_contact_ids` (legacy / Case Tracker sync order).
 */
export function inferResponsibleAttorneyContactId(
  caseRecord: Pick<Case, "responsibleAttorneyContactId" | "assignedContactIds">,
  contactById: Map<string, Contact>
): string | null {
  if (caseRecord.responsibleAttorneyContactId?.trim()) {
    return caseRecord.responsibleAttorneyContactId.trim();
  }
  for (const id of caseRecord.assignedContactIds) {
    if (contactById.get(id)?.role === "attorney") return id;
  }
  return null;
}

/** @deprecated alias */
export const inferMainAttorneyContactId = inferResponsibleAttorneyContactId;

export function inferParalegalContactId(
  caseRecord: Pick<Case, "assignedContactIds">,
  contactById: Map<string, Contact>
): string | null {
  for (const id of caseRecord.assignedContactIds) {
    if (contactById.get(id)?.role === "paralegal") return id;
  }
  return null;
}

/**
 * Assignees written to `assigned_contact_ids`. Responsible attorney first (Case Tracker sync),
 * then paralegal and non-attorney extras. Event attorney is excluded intentionally.
 */
export function buildCaseAssignedContactIds(args: {
  responsibleAttorneyId: string;
  paralegalId: string;
  extraIds?: string[];
  contactById?: Map<string, Contact>;
}): string[] {
  const { responsibleAttorneyId, paralegalId, extraIds = [], contactById } = args;
  const reserved = new Set([responsibleAttorneyId, paralegalId].filter(Boolean));
  const extras = extraIds.filter((id) => {
    if (!id?.trim() || reserved.has(id)) return false;
    if (contactById?.get(id)?.role === "attorney") return false;
    return true;
  });
  return [...new Set([responsibleAttorneyId, paralegalId, ...extras].filter(Boolean))];
}

/** Contact ids for Google calendar invites (assignees + optional event attorney + event extras). */
export function caseCalendarInviteContactIds(
  caseRecord: Pick<Case, "assignedContactIds" | "eventAttorneyContactId">,
  extraContactIds: string[] = []
): string[] {
  const ids = [...caseRecord.assignedContactIds];
  const eventAttorney = caseRecord.eventAttorneyContactId?.trim();
  if (eventAttorney) ids.push(eventAttorney);
  return [...new Set([...ids, ...extraContactIds].filter(Boolean))];
}

export function caseCalendarInviteContactIdsForEvent(
  caseRecord: Case,
  event: Pick<CalendarEvent, "extraInternalContactIds">
): string[] {
  return caseCalendarInviteContactIds(caseRecord, event.extraInternalContactIds ?? []);
}

export type CaseContactSlots = {
  responsibleAttorneyId: string;
  eventAttorneyId: string;
  paralegalId: string;
  extraIds: string[];
};

export function caseContactSlotsFromCase(
  caseRecord: Case,
  contactById: Map<string, Contact>
): CaseContactSlots {
  const responsibleAttorneyId = inferResponsibleAttorneyContactId(caseRecord, contactById) ?? "";
  const eventAttorneyId = caseRecord.eventAttorneyContactId?.trim() ?? "";
  const paralegalId = inferParalegalContactId(caseRecord, contactById) ?? "";
  const reserved = new Set([responsibleAttorneyId, paralegalId].filter(Boolean));
  const extraIds = caseRecord.assignedContactIds.filter((id) => !reserved.has(id));
  return { responsibleAttorneyId, eventAttorneyId, paralegalId, extraIds };
}

export function caseContactDisplayLabel(
  contactId: string,
  caseRecord: Case,
  contactById: Map<string, Contact>
): "Main attorney" | null {
  const main = inferResponsibleAttorneyContactId(caseRecord, contactById);
  if (contactId === main && contactById.get(contactId)?.role === "attorney") {
    return "Main attorney";
  }
  return null;
}
