type SlackApiResponse = { ok?: boolean; error?: string };

async function slackApi(
  token: string,
  method: string,
  body: Record<string, unknown>
): Promise<SlackApiResponse> {
  const res = await fetch(`https://slack.com/api/${method}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(body),
  });
  return (await res.json()) as SlackApiResponse;
}

/** Join a public channel so the bot can post (requires `channels:join`). */
async function ensureBotInSlackChannel(token: string, channelId: string): Promise<void> {
  const channel = channelId.trim();
  const join = await slackApi(token, "conversations.join", { channel });
  if (join.ok || join.error === "already_in_channel") {
    return;
  }
  // Private channels cannot be joined without a prior invite; still attempt post below.
  if (
    join.error === "method_not_supported_for_channel_type" ||
    join.error === "is_archived"
  ) {
    return;
  }
  throw new Error(join.error ?? "Failed to join Slack channel");
}

/** Post a message to a Slack channel as the DocketFlow bot (server-only). */
export async function postSlackChannelMessage(
  channelId: string,
  text: string
): Promise<void> {
  const token = process.env.SLACK_BOT_TOKEN?.trim();
  if (!token) {
    throw new Error("SLACK_BOT_TOKEN is not configured");
  }

  const channel = channelId.trim();
  const message = {
    channel,
    text,
    username: "DocketFlow",
    icon_emoji: ":calendar:",
    unfurl_links: false,
    unfurl_media: false,
  };

  await ensureBotInSlackChannel(token, channel);

  let post = await slackApi(token, "chat.postMessage", message);
  if (!post.ok && post.error === "not_in_channel") {
    await ensureBotInSlackChannel(token, channel);
    post = await slackApi(token, "chat.postMessage", message);
  }

  if (!post.ok) {
    throw new Error(post.error ?? "Slack post failed");
  }
}
