const SLACK_WORKSPACE = "ramosjames";

/** Firm Slack workspace channel URL (opens in browser or Slack app). */
export function slackChannelUrl(channelId: string): string {
  const id = channelId.trim();
  return `https://${SLACK_WORKSPACE}.slack.com/archives/${encodeURIComponent(id)}`;
}

export function slackChannelLabel(name: string | null | undefined, channelId: string): string {
  const n = name?.trim();
  if (n) return n.startsWith("#") ? n : `#${n}`;
  return channelId.trim();
}
