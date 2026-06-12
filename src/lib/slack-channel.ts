/** Open Slack channel in app or web (works without workspace subdomain in env). */
export function slackChannelUrl(channelId: string): string {
  const id = channelId.trim();
  return `https://slack.com/app_redirect?channel=${encodeURIComponent(id)}`;
}

export function slackChannelLabel(name: string | null | undefined, channelId: string): string {
  const n = name?.trim();
  if (n) return n.startsWith("#") ? n : `#${n}`;
  return channelId.trim();
}
