import { quoContactLastName } from "@/lib/client-name";

const QUO_CONTACTS_URL = "https://api.openphone.com/v1/contacts";

export type QuoCreateContactInput = {
  firstName: string;
  lastName: string;
  caseNumber: string;
  phoneE164: string;
};

export function buildQuoContactPayload(input: QuoCreateContactInput): {
  defaultFields: {
    firstName: string;
    lastName: string;
    phoneNumbers: { name: string; value: string }[];
  };
} {
  return {
    defaultFields: {
      firstName: input.firstName.trim(),
      lastName: quoContactLastName(input.lastName, input.caseNumber),
      phoneNumbers: [{ name: "primary", value: input.phoneE164 }],
    },
  };
}

export async function createQuoContact(
  input: QuoCreateContactInput
): Promise<{ id: string } | { skipped: true; reason: string }> {
  const apiKey = process.env.QUO_API_KEY?.trim();
  if (!apiKey) {
    return { skipped: true, reason: "quo_not_configured" };
  }

  const res = await fetch(QUO_CONTACTS_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: apiKey,
    },
    body: JSON.stringify(buildQuoContactPayload(input)),
  });

  const json = (await res.json().catch(() => ({}))) as {
    data?: { id?: string };
    error?: { message?: string };
    message?: string;
  };

  if (!res.ok) {
    const message = json.error?.message ?? json.message ?? `Quo API error (${res.status})`;
    throw new Error(message);
  }

  const id = json.data?.id?.trim();
  if (!id) throw new Error("Quo API did not return a contact id");
  return { id };
}
