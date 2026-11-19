import type { Contact, ContactRole } from "@/lib/types";

export const CONTACT_CAPABILITY_ROLES: ContactRole[] = [
  "attorney",
  "paralegal",
  "legal_assistant",
  "other",
];

export function normalizeContactRoles(
  roles: string[] | null | undefined,
  primary: string | null | undefined,
): { role: ContactRole; roles: ContactRole[] } {
  const cleaned = [
    ...new Set(
      (roles ?? [])
        .map((value) => String(value ?? "").trim())
        .filter((value): value is ContactRole =>
          CONTACT_CAPABILITY_ROLES.includes(value as ContactRole),
        ),
    ),
  ];
  const primaryRole = CONTACT_CAPABILITY_ROLES.includes(primary as ContactRole)
    ? (primary as ContactRole)
    : null;

  if (cleaned.length === 0 && primaryRole) {
    return { role: primaryRole, roles: [primaryRole] };
  }
  if (!primaryRole && cleaned.length > 0) {
    return { role: cleaned[0]!, roles: cleaned };
  }
  if (primaryRole && !cleaned.includes(primaryRole)) {
    return { role: primaryRole, roles: [primaryRole, ...cleaned] };
  }
  return { role: primaryRole ?? "other", roles: cleaned.length ? cleaned : ["other"] };
}

export function contactRoleList(contact: Pick<Contact, "role" | "roles">): ContactRole[] {
  return normalizeContactRoles(contact.roles, contact.role).roles;
}

export function hasContactRole(
  contact: Pick<Contact, "role" | "roles"> | null | undefined,
  want: ContactRole,
): boolean {
  if (!contact) return false;
  return contactRoleList(contact).includes(want);
}

export function withToggledContactRole(
  contact: Pick<Contact, "role" | "roles">,
  role: ContactRole,
  enabled: boolean,
): { role: ContactRole; roles: ContactRole[] } {
  const current = new Set(contactRoleList(contact));
  if (enabled) current.add(role);
  else current.delete(role);

  let roles = [...current];
  if (roles.length === 0) roles = [contact.role || role];

  let primary = contact.role;
  if (!roles.includes(primary)) primary = roles[0]!;
  if (!enabled && primary === role) {
    primary = roles.find((value) => value !== "other") ?? roles[0]!;
  }
  return { role: primary, roles };
}
