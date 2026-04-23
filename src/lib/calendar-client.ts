/** POST body to `/api/calendar/sync` (create/update/delete). */
export async function postCalendarSync(body: unknown, idToken: string | null): Promise<Response> {
  return fetch("/api/calendar/sync", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
    },
    body: JSON.stringify(body),
  });
}
