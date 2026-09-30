import { createHmac, timingSafeEqual } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Contact } from "@/lib/types";

const FIRM_EMAIL_DOMAIN = "@ramosjames.com";
const SIGNATURE_MAX_SKEW_SECONDS = 60 * 5;
const CACHE_TTL_MS = 5 * 60 * 1000;

export type McpCaller = {
  email: string;
  slackUserId: string | null;
  /** `auth.users.id` — required for writes (`case_events.user_id`, checklist `completed_by`). */
  authUserId: string | null;
  contact: Contact | null;
  /** Name for checklist notes / audit (`checklist_profiles.display_name` → contact name → email). */
  displayName: string;
  /** Lowercased names that may appear in `checklist_tasks.owner_name` for this person. */
  checklistOwnerNames: string[];
};

/** Slack request signing: `v0=` HMAC-SHA256 of `v0:{timestamp}:{rawBody}`. */
export function verifySlackSignature(
  rawBody: string,
  timestampHeader: string | null,
  signatureHeader: string | null,
  signingSecret: string
): boolean {
  if (!timestampHeader || !signatureHeader) return false;
  const ts = Number(timestampHeader);
  if (!Number.isFinite(ts)) return false;
  if (Math.abs(Date.now() / 1000 - ts) > SIGNATURE_MAX_SKEW_SECONDS) return false;
  const expected =
    "v0=" + createHmac("sha256", signingSecret).update(`v0:${timestampHeader}:${rawBody}`).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(signatureHeader.trim());
  return a.length === b.length && timingSafeEqual(a, b);
}

const slackEmailCache = new Map<string, { email: string | null; at: number }>();

/** Slack `users.info` → profile email (bot scopes `users:read` + `users:read.email`). */
export async function slackUserEmail(userId: string): Promise<string | null> {
  const hit = slackEmailCache.get(userId);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.email;
  const token = process.env.SLACK_BOT_TOKEN?.trim();
  if (!token) throw new Error("SLACK_BOT_TOKEN is not configured");
  const res = await fetch(`https://slack.com/api/users.info?user=${encodeURIComponent(userId)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const json = (await res.json()) as {
    ok?: boolean;
    error?: string;
    user?: { deleted?: boolean; is_bot?: boolean; profile?: { email?: string } };
  };
  if (!json.ok) throw new Error(`Slack users.info failed: ${json.error ?? res.status}`);
  const email =
    json.user && !json.user.deleted && !json.user.is_bot
      ? json.user.profile?.email?.trim().toLowerCase() || null
      : null;
  slackEmailCache.set(userId, { email, at: Date.now() });
  return email;
}

const authUserIdCache = new Map<string, { id: string | null; at: number }>();

async function authUserIdForEmail(supabase: SupabaseClient, email: string): Promise<string | null> {
  const hit = authUserIdCache.get(email);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.id;
  let found: string | null = null;
  for (let page = 1; page <= 20 && !found; page++) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    for (const u of data.users) {
      if (u.email?.trim().toLowerCase() === email) {
        found = u.id;
        break;
      }
    }
    if (data.users.length < 1000) break;
  }
  authUserIdCache.set(email, { id: found, at: Date.now() });
  return found;
}

export function isFirmEmail(email: string): boolean {
  return email.trim().toLowerCase().endsWith(FIRM_EMAIL_DOMAIN);
}

/** Resolve a verified firm email into DocketFlow + checklist identities. */
export async function resolveCaller(
  supabase: SupabaseClient,
  emailRaw: string,
  slackUserId: string | null
): Promise<McpCaller> {
  const email = emailRaw.trim().toLowerCase();
  if (!isFirmEmail(email)) {
    throw new Error("DocketFlow is only available to @ramosjames.com staff.");
  }

  const [{ data: contactRow, error: contactErr }, authUserId] = await Promise.all([
    supabase
      .from("contacts")
      .select("*")
      .ilike("email", email.replace(/[%_\\]/g, "\\$&"))
      .limit(1)
      .maybeSingle(),
    authUserIdForEmail(supabase, email),
  ]);
  if (contactErr) throw contactErr;

  const contact: Contact | null = contactRow
    ? {
        id: contactRow.id as string,
        ownerId: contactRow.user_id as string,
        name: contactRow.name as string,
        email: contactRow.email as string,
        role: contactRow.role as Contact["role"],
        teamCalendarScope:
          contactRow.team_calendar_scope === "all_firm_events" ? "all_firm_events" : "assigned_cases",
        createdAt: Number(contactRow.created_at),
        updatedAt: Number(contactRow.updated_at),
      }
    : null;

  type Profile = { display_name: string | null; staff_label: string | null };
  let profile: Profile | null = null;
  if (authUserId) {
    const { data, error } = await supabase
      .from("checklist_profiles")
      .select("display_name, staff_label")
      .eq("user_id", authUserId)
      .maybeSingle();
    if (error) throw error;
    profile = (data as Profile | null) ?? null;
  }

  const ownerNames = new Set<string>();
  for (const n of [profile?.staff_label, contact?.name]) {
    const t = n?.trim().toLowerCase();
    if (t) ownerNames.add(t);
  }

  return {
    email,
    slackUserId,
    authUserId,
    contact,
    displayName: profile?.display_name?.trim() || contact?.name?.trim() || email,
    checklistOwnerNames: [...ownerNames],
  };
}
