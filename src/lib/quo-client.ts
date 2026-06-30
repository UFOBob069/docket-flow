export type QuoContactSyncBody = {
  caseId: string;
  firstName: string;
  lastName: string;
  caseNumber: string;
  phone: string;
};

export type QuoContactSyncResult = {
  ok: boolean;
  synced?: boolean;
  quoContactId?: string;
  reason?: string;
  error?: string;
};

/** Create or refresh the client contact in Quo for a case (server route). */
export async function postQuoContactSync(
  body: QuoContactSyncBody,
  idToken: string | null
): Promise<QuoContactSyncResult> {
  const res = await fetch("/api/quo/contact", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
    },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as QuoContactSyncResult;
  if (!res.ok) {
    return { ok: false, error: data.error ?? `Quo sync failed (${res.status})` };
  }
  return data;
}
