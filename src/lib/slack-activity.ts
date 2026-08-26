import { ACTIVITY_ACTION_LABELS } from "@/lib/activity-labels";
import type { ActivityAction } from "@/lib/types";

export type SlackActivityPayload = {
  caseId: string;
  caseName?: string | null;
  action: ActivityAction;
  description: string;
  userEmail: string;
};

/** Canonical public origin for Slack / user-facing links (not per-deploy preview hosts). */
export function appBaseUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL?.trim().replace(/\/$/, "");
  if (explicit) return explicit.includes("://") ? explicit : `https://${explicit}`;

  // Prefer the project production domain over VERCEL_URL (unique deploy host like *.vercel.app hash).
  const production = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim().replace(/\/$/, "");
  if (production) return production.includes("://") ? production : `https://${production}`;

  const vercel = process.env.VERCEL_URL?.trim().replace(/\/$/, "");
  if (vercel) return vercel.includes("://") ? vercel : `https://${vercel}`;
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
