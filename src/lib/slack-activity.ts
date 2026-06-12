import { ACTIVITY_ACTION_LABELS } from "@/lib/activity-labels";
import type { ActivityAction } from "@/lib/types";

export type SlackActivityPayload = {
  caseId: string;
  caseName?: string | null;
  action: ActivityAction;
  description: string;
  userEmail: string;
};

export function appBaseUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL?.trim().replace(/\/$/, "");
  if (explicit) return explicit;
  const vercel = process.env.VERCEL_URL?.trim();
  if (vercel) return `https://${vercel}`;
  return "http://localhost:3000";
}

/** Plain-text + mrkdwn body for `chat.postMessage`. */
export function formatActivitySlackMessage(payload: SlackActivityPayload): string {
  const who = payload.userEmail?.trim() || "Someone";
  const verb = ACTIVITY_ACTION_LABELS[payload.action] ?? payload.action;
  const caseLabel = payload.caseName?.trim() || "Case";
  const caseUrl = `${appBaseUrl()}/cases/${payload.caseId}`;
  const lines = [
    `*DocketFlow* — ${who} ${verb}`,
    caseLabel,
  ];
  if (payload.description?.trim()) {
    lines.push(payload.description.trim());
  }
  lines.push(`<${caseUrl}|Open in DocketFlow>`);
  return lines.join("\n");
}
