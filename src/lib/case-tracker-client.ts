/**
 * Case Tracker ↔ DocketFlow server callbacks (shared DOCKETFLOW_INTERNAL_API_SECRET / CRON_SECRET).
 */

function getInternalApiSecret() {
  return process.env.DOCKETFLOW_INTERNAL_API_SECRET?.trim() || process.env.CRON_SECRET?.trim() || "";
}

export function getCaseTrackerBaseUrl() {
  return (
    process.env.CASE_TRACKER_URL?.trim().replace(/\/$/, "") ||
    process.env.NEXT_PUBLIC_CASE_TRACKER_URL?.trim().replace(/\/$/, "") ||
    null
  );
}

export type CaseTrackerSlackTopicSyncResult =
  | { ok: true; skipped: true; reason: string }
  | { ok: true; skipped: false; updated?: boolean; status: number }
  | { ok: false; skipped: false; reason: string; status?: number };

/**
 * Ask Case Tracker to rewrite the Slack channel topic from current case assignment.
 * No-ops (skipped) when URL/secret missing so local DF still works.
 */
export async function requestCaseTrackerSlackTopicSync(
  caseId: string,
  opts?: { caseNumber?: string | null; source?: string }
): Promise<CaseTrackerSlackTopicSyncResult> {
  const base = getCaseTrackerBaseUrl();
  const secret = getInternalApiSecret();
  if (!base) {
    return { ok: true, skipped: true, reason: "missing_case_tracker_url" };
  }
  if (!secret) {
    return { ok: true, skipped: true, reason: "missing_shared_secret" };
  }

  const url = `${base}/api/internal/docketflow/sync-slack-topic`;
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${secret}`,
      },
      body: JSON.stringify({
        caseId,
        ...(opts?.caseNumber ? { caseNumber: opts.caseNumber } : {}),
        source: opts?.source ?? "docketflow",
      }),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      console.warn("[case-tracker] slack topic sync failed", {
        caseId,
        status: response.status,
        body: text.slice(0, 500),
      });
      return { ok: false, skipped: false, reason: "http_error", status: response.status };
    }

    const json = (await response.json().catch(() => ({}))) as {
      skipped?: boolean;
      reason?: string;
      updated?: boolean;
    };
    if (json.skipped) {
      return { ok: true, skipped: true, reason: json.reason ?? "skipped" };
    }
    return { ok: true, skipped: false, updated: Boolean(json.updated), status: response.status };
  } catch (error) {
    console.warn("[case-tracker] slack topic sync request error", {
      caseId,
      error: error instanceof Error ? error.message : String(error),
    });
    return { ok: false, skipped: false, reason: "network_error" };
  }
}
