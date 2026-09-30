import type { SupabaseClient } from "@supabase/supabase-js";
import { caseCalendarInviteContactIds, caseCalendarInviteContactIdsForEvent } from "@/lib/case-attorneys";
import { caseDisplayName } from "@/lib/case-display";
import {
  CASE_EVENT_KIND_SECTIONS,
  getFixedRemindersForKind,
  isTaxonomyEventKind,
} from "@/lib/case-event-kinds";
import { googleCalendarDescription } from "@/lib/calendar-payload";
import { isGoogleIcsMirrorEvent } from "@/lib/calendar-event-origin";
import { mergeAttendeeEmailLists } from "@/lib/calendar-global-recipients";
import { parseOneTimeEmailsFromExternalText } from "@/lib/event-attendees";
import { createAdHocCalendarEvent, CALENDAR_TIMEZONE } from "@/lib/event-factory";
import {
  validateEventScheduleAgainstFederalHolidays,
  type FederalHolidayIndex,
} from "@/lib/federal-holidays";
import { insertGoogleEvent, patchGoogleEvent, patchSolMilestoneGoogleEvent } from "@/lib/google-calendar";
import {
  categoryForManualEventKind,
  EVENT_KIND_LABELS,
  manualEventNeedsDeponentField,
} from "@/lib/one-off-events";
import { appBaseUrl, formatActivitySlackMessage } from "@/lib/slack-activity";
import { postSlackChannelMessage } from "@/lib/slack-notify";
import {
  fetchCase,
  fetchCasesByIds,
  fetchCasesForContact,
  fetchContactsForUser,
  fetchEventById,
  fetchFullEventsForCases,
  fetchSlackChannelForCase,
  findCaseByCaseNumber,
  logActivity,
  saveEvent,
} from "@/lib/supabase/repo";
import type { ActivityAction, CalendarEvent, Case, Contact, EventKind, EventScheduleKind } from "@/lib/types";
import {
  addDaysYmd,
  chicagoLocalToIso,
  isoToChicagoParts,
  parseWhen,
  todayChicagoYmd,
  type ParsedWhen,
} from "./chicago-time";
import type { McpCaller } from "./identity";

export type McpToolContext = { supabase: SupabaseClient; caller: McpCaller };

export type McpToolDefinition = {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations: {
    title?: string;
    readOnlyHint: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
    openWorldHint?: boolean;
  };
  handler: (args: Record<string, unknown>, ctx: McpToolContext) => Promise<unknown>;
};

/** Message is safe to show the Slack user (bad input, not found, not allowed). */
export class ToolUserError extends Error {}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SLACKBOT_SUFFIX = " — via Slackbot";

/* ── Argument helpers ───────────────────────────────────────────── */

function optString(args: Record<string, unknown>, key: string): string | undefined {
  const v = args[key];
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "string") throw new ToolUserError(`${key} must be a string`);
  return v;
}

function reqString(args: Record<string, unknown>, key: string): string {
  const v = optString(args, key)?.trim();
  if (!v) throw new ToolUserError(`${key} is required`);
  return v;
}

function optBool(args: Record<string, unknown>, key: string): boolean | undefined {
  const v = args[key];
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "boolean") throw new ToolUserError(`${key} must be true or false`);
  return v;
}

function optInt(args: Record<string, unknown>, key: string, min: number, max: number): number | undefined {
  const v = args[key];
  if (v === undefined || v === null) return undefined;
  const n = typeof v === "string" ? Number(v) : v;
  if (typeof n !== "number" || !Number.isInteger(n) || n < min || n > max) {
    throw new ToolUserError(`${key} must be a whole number from ${min} to ${max}`);
  }
  return n;
}

function optStringArray(args: Record<string, unknown>, key: string): string[] {
  const v = args[key];
  if (v === undefined || v === null) return [];
  if (typeof v === "string") return v.split(/[,;\n]/).map((s) => s.trim()).filter(Boolean);
  if (!Array.isArray(v) || v.some((x) => typeof x !== "string")) {
    throw new ToolUserError(`${key} must be a list of names`);
  }
  return (v as string[]).map((s) => s.trim()).filter(Boolean);
}

function reqUuid(args: Record<string, unknown>, key: string): string {
  const v = reqString(args, key);
  if (!UUID_RE.test(v)) throw new ToolUserError(`${key} must be an id returned by a DocketFlow tool`);
  return v;
}

function optYmd(args: Record<string, unknown>, key: string): string | undefined {
  const raw = optString(args, key)?.trim();
  if (!raw) return undefined;
  const w = parseWhen(raw);
  if (!w) throw new ToolUserError(`${key} must be a date like 2026-10-05`);
  return w.date;
}

function requireWriter(caller: McpCaller): string {
  if (!caller.authUserId) {
    throw new ToolUserError(
      `${caller.email} has not signed in to DocketFlow yet. Sign in once at ${appBaseUrl()} before making changes from Slack.`
    );
  }
  return caller.authUserId;
}

/* ── Lookups ─────────────────────────────────────────────────────── */

async function requireCase(supabase: SupabaseClient, caseNumberRaw: string): Promise<Case> {
  const cleaned = caseNumberRaw.replace(/[^A-Za-z0-9-]/g, "");
  if (!cleaned) throw new ToolUserError("case_number is required (e.g. 12345)");
  const c = await findCaseByCaseNumber(supabase, cleaned);
  if (!c) throw new ToolUserError(`No DocketFlow case found for case number ${cleaned}.`);
  return c;
}

function caseSummary(c: Case) {
  return {
    case_id: c.id,
    case_number: c.caseNumber ?? c.causeNumber ?? null,
    name: caseDisplayName(c),
    status: c.status === "archived" ? "closed" : "open",
    url: `${appBaseUrl()}/cases/${c.id}`,
  };
}

async function loadFederalHolidays(supabase: SupabaseClient): Promise<FederalHolidayIndex> {
  const { data, error } = await supabase.from("federal_holidays").select("observed_date, name");
  if (error) throw error;
  const index = new Map<string, string>();
  for (const row of data ?? []) {
    const d = String(row.observed_date).slice(0, 10);
    if (d && row.name) index.set(d, String(row.name));
  }
  return index;
}

const TAXONOMY_KINDS = CASE_EVENT_KIND_SECTIONS.flatMap((s) =>
  s.kinds.map((k) => ({ value: k.value, label: k.label, section: s.title }))
);

function resolveEventKind(raw: string): EventKind {
  const q = raw.trim().toLowerCase();
  const hit =
    TAXONOMY_KINDS.find((k) => k.value === q) ??
    TAXONOMY_KINDS.find((k) => k.label.toLowerCase() === q);
  if (!hit) {
    throw new ToolUserError(
      `Unknown kind "${raw}". Use one of: ${TAXONOMY_KINDS.map((k) => k.value).join(", ")}`
    );
  }
  return hit.value;
}

function matchContactsByName(names: string[], contacts: Contact[]): Contact[] {
  const withEmail = contacts.filter((c) => c.email?.trim());
  const out: Contact[] = [];
  for (const raw of names) {
    const q = raw.trim().toLowerCase();
    let hits = withEmail.filter(
      (c) => c.name.trim().toLowerCase() === q || c.email.trim().toLowerCase() === q
    );
    if (!hits.length) hits = withEmail.filter((c) => c.name.toLowerCase().split(/\s+/)[0] === q);
    if (!hits.length) hits = withEmail.filter((c) => c.name.toLowerCase().includes(q));
    if (hits.length !== 1) {
      const options = (hits.length ? hits : withEmail).map((c) => c.name).slice(0, 40);
      throw new ToolUserError(
        hits.length
          ? `"${raw}" matches more than one person: ${options.join(", ")}. Use the full name.`
          : `No DocketFlow contact named "${raw}". Contacts: ${options.join(", ")}`
      );
    }
    if (!out.some((c) => c.id === hits[0]!.id)) out.push(hits[0]!);
  }
  return out;
}

/* ── Event formatting ───────────────────────────────────────────── */

function formatEvent(ev: CalendarEvent, c: Case | undefined, contactById: Map<string, Contact>) {
  const start = ev.startDateTime ? isoToChicagoParts(ev.startDateTime) : null;
  const end = ev.endDateTime ? isoToChicagoParts(ev.endDateTime) : null;
  const internalIds = c ? caseCalendarInviteContactIdsForEvent(c, ev) : ev.extraInternalContactIds ?? [];
  const desc = ev.description?.trim() ?? "";
  return {
    event_id: ev.id,
    ...(c ? { case_number: c.caseNumber ?? c.causeNumber ?? null, case_name: caseDisplayName(c) } : {}),
    title: ev.title,
    kind: ev.eventKind ?? null,
    kind_label: ev.eventKind ? EVENT_KIND_LABELS[ev.eventKind] ?? ev.eventKind : null,
    category: ev.category,
    schedule_kind: ev.scheduleKind,
    date: ev.date,
    ...(ev.deadlineEndDate ? { last_day: ev.deadlineEndDate } : {}),
    all_day: !start,
    start_time: start ? `${start.date} ${start.time}` : null,
    end_time: end ? `${end.date} ${end.time}` : null,
    timezone: CALENDAR_TIMEZONE,
    completed: ev.completed,
    zoom_link: ev.zoomLink?.trim() || null,
    deponent_or_subject: ev.deponentOrSubject?.trim() || null,
    attendees: {
      internal: internalIds.map((id) => contactById.get(id)?.name).filter(Boolean),
      external: ev.externalAttendeesText?.trim() || null,
      one_time_invite_emails: parseOneTimeEmailsFromExternalText(ev.externalAttendeesText),
    },
    description: desc.length > 1500 ? `${desc.slice(0, 1500)}…` : desc || null,
    google_calendar_synced: Boolean(
      ev.googleEventId ||
        ev.googleHostCalendarId ||
        (ev.googleCalendarEventIdsByEmail && Object.keys(ev.googleCalendarEventIdsByEmail).length)
    ),
    source: isGoogleIcsMirrorEvent(ev) ? "google_mirror" : "docketflow",
  };
}

function eventLastDay(ev: CalendarEvent): string {
  return ev.deadlineEndDate && ev.deadlineEndDate > ev.date ? ev.deadlineEndDate : ev.date;
}

/* ── Side effects shared by write tools (mirror the UI) ────────── */

async function postCaseActivityToSlack(
  supabase: SupabaseClient,
  c: Case,
  action: ActivityAction,
  description: string,
  userEmail: string
): Promise<boolean> {
  if (!process.env.SLACK_BOT_TOKEN?.trim()) return false;
  try {
    const slack = await fetchSlackChannelForCase(supabase, {
      caseNumber: c.caseNumber ?? null,
      causeNumber: c.causeNumber ?? null,
    });
    if (!slack?.slackChannelId) return false;
    await postSlackChannelMessage(
      slack.slackChannelId,
      formatActivitySlackMessage({
        caseId: c.id,
        caseName: caseDisplayName(c),
        action,
        description,
        userEmail,
      })
    );
    return true;
  } catch (e) {
    console.warn("[mcp] Slack activity post failed", e);
    return false;
  }
}

async function recordCaseActivity(
  supabase: SupabaseClient,
  caller: McpCaller,
  authUserId: string,
  c: Case,
  action: ActivityAction,
  description: string
): Promise<{ activity_logged: boolean; slack_posted: boolean }> {
  const full = `${description}${SLACKBOT_SUFFIX}`;
  let logged = false;
  try {
    await logActivity(supabase, authUserId, {
      caseId: c.id,
      caseName: caseDisplayName(c),
      action,
      description: full,
      userEmail: caller.email,
    });
    logged = true;
  } catch (e) {
    console.warn("[mcp] activity log failed", e);
  }
  const posted = await postCaseActivityToSlack(supabase, c, action, full, caller.email);
  return { activity_logged: logged, slack_posted: posted };
}

/** After a service-role write the checklist trigger logs `actor_id = null`; attribute it to the caller. */
async function stampChecklistEventActor(
  supabase: SupabaseClient,
  taskId: string,
  caller: McpCaller,
  sinceIso: string
): Promise<void> {
  const { error } = await supabase
    .from("checklist_task_events")
    .update({ actor_id: caller.authUserId, actor_name: caller.displayName })
    .eq("task_id", taskId)
    .is("actor_id", null)
    .gte("created_at", sinceIso);
  if (error) console.warn("[mcp] checklist event actor stamp failed", error.message);
}

/* ── Schedule parsing for create/update ─────────────────────────── */

type Schedule = {
  date: string;
  startTime: string | null;
  endTime: string | null;
  deadlineEndDate: string | null;
};

function scheduleFromInputs(start: ParsedWhen, end: ParsedWhen | null): Schedule {
  if (start.time) {
    if (end && !end.time) {
      throw new ToolUserError("end must include a time when start has a time (e.g. 2026-10-05T11:00).");
    }
    if (end && end.date !== start.date) {
      throw new ToolUserError("Timed events must start and end on the same day.");
    }
    if (end && end.time! <= start.time) {
      throw new ToolUserError("end time must be after start time.");
    }
    return { date: start.date, startTime: start.time, endTime: end?.time ?? null, deadlineEndDate: null };
  }
  if (end?.time) {
    throw new ToolUserError("Give start a time too, or pass end as a date for a multi-day deadline.");
  }
  if (end && end.date <= start.date) {
    throw new ToolUserError("end (last day) must be after the start date, or omit it for a single day.");
  }
  return { date: start.date, startTime: null, endTime: null, deadlineEndDate: end?.date ?? null };
}

function parseWhenArg(args: Record<string, unknown>, key: string): ParsedWhen | null {
  const raw = optString(args, key)?.trim();
  if (!raw) return null;
  const w = parseWhen(raw);
  if (!w) {
    throw new ToolUserError(
      `${key} must look like 2026-10-05 (all day) or 2026-10-05T14:30 (Central time).`
    );
  }
  return w;
}

/* ── Read tools ─────────────────────────────────────────────────── */

async function listCaseEvents(args: Record<string, unknown>, { supabase }: McpToolContext) {
  const c = await requireCase(supabase, reqString(args, "case_number"));
  const from = optYmd(args, "from");
  const to = optYmd(args, "to");
  const includeCompleted = optBool(args, "include_completed") ?? false;
  const [events, contacts] = await Promise.all([
    fetchFullEventsForCases(supabase, [c.id], { from, to }),
    fetchContactsForUser(supabase, ""),
  ]);
  const byId = new Map(contacts.map((ct) => [ct.id, ct]));
  const today = todayChicagoYmd();
  const visible = events.filter((ev) => ev.included !== false && (includeCompleted || !ev.completed));
  const upcoming = visible.filter((ev) => eventLastDay(ev) >= today);
  const past = visible.filter((ev) => eventLastDay(ev) < today).reverse();
  return {
    case: caseSummary(c),
    today,
    timezone: CALENDAR_TIMEZONE,
    upcoming_count: upcoming.length,
    past_count: past.length,
    upcoming: upcoming.slice(0, 75).map((ev) => formatEvent(ev, c, byId)),
    past_most_recent_first: past.slice(0, 25).map((ev) => formatEvent(ev, c, byId)),
    ...(upcoming.length > 75 || past.length > 25
      ? { note: "Lists truncated — narrow with from/to for more." }
      : {}),
  };
}

async function myUpcomingEvents(args: Record<string, unknown>, { supabase, caller }: McpToolContext) {
  const days = optInt(args, "days", 1, 90) ?? 14;
  const scope = optString(args, "scope") === "firm" ? "firm" : "mine";
  const from = todayChicagoYmd();
  const to = addDaysYmd(from, days);

  let cases: Case[];
  let extraInviteeCaseIds = new Set<string>();
  if (scope === "mine") {
    if (!caller.contact) {
      throw new ToolUserError(
        `${caller.email} is not a DocketFlow contact, so there are no assigned cases. Try scope "firm".`
      );
    }
    const contactId = caller.contact.id;
    const [assigned, extraRows] = await Promise.all([
      fetchCasesForContact(supabase, contactId, { activeOnly: true }),
      supabase
        .from("case_events")
        .select("case_id")
        .contains("extra_internal_contact_ids", [contactId])
        .gte("date", from)
        .lte("date", to),
    ]);
    if (extraRows.error) throw extraRows.error;
    extraInviteeCaseIds = new Set((extraRows.data ?? []).map((r) => r.case_id as string));
    const missing = [...extraInviteeCaseIds].filter((id) => !assigned.some((c) => c.id === id));
    cases = [...assigned, ...(missing.length ? await fetchCasesByIds(supabase, missing) : [])];
  } else {
    const { data, error } = await supabase
      .from("case_events")
      .select("case_id")
      .gte("date", from)
      .lte("date", to)
      .eq("completed", false)
      .limit(5000);
    if (error) throw error;
    cases = (await fetchCasesByIds(supabase, (data ?? []).map((r) => r.case_id as string))).filter(
      (c) => c.status === "active"
    );
  }

  const caseById = new Map(cases.map((c) => [c.id, c]));
  const [events, contacts] = await Promise.all([
    fetchFullEventsForCases(supabase, [...caseById.keys()], { from, to }),
    fetchContactsForUser(supabase, ""),
  ]);
  const byId = new Map(contacts.map((ct) => [ct.id, ct]));
  const contactId = caller.contact?.id;
  const mine = events.filter((ev) => {
    if (ev.completed || ev.included === false) return false;
    if (scope === "firm") return true;
    const c = caseById.get(ev.caseId);
    if (!c) return false;
    return caseCalendarInviteContactIdsForEvent(c, ev).includes(contactId!);
  });
  mine.sort((a, b) =>
    a.date === b.date
      ? (a.startDateTime ?? "").localeCompare(b.startDateTime ?? "")
      : a.date.localeCompare(b.date)
  );
  return {
    caller: { email: caller.email, contact: caller.contact?.name ?? null },
    scope,
    from,
    to,
    timezone: CALENDAR_TIMEZONE,
    count: mine.length,
    events: mine.slice(0, 150).map((ev) => formatEvent(ev, caseById.get(ev.caseId), byId)),
    ...(mine.length > 150 ? { note: "Showing the first 150 — use fewer days for the rest." } : {}),
  };
}

type ChecklistTaskRow = {
  id: string;
  case_id: string;
  title: string;
  stage: string | null;
  sequence: number | null;
  status: string;
  owner_id: string | null;
  owner_name: string | null;
  additional_owners: string[] | null;
  due_at: string | null;
  type: string | null;
  types: string[] | null;
  completed_at: string | null;
};

const TASK_COLUMNS =
  "id, case_id, title, stage, sequence, status, owner_id, owner_name, additional_owners, due_at, type, types, completed_at";

function formatTask(t: ChecklistTaskRow, today: string, fallbackOwner: string | null) {
  const open = t.status === "active";
  return {
    task_id: t.id,
    title: t.title,
    stage: t.stage,
    status: t.status,
    owner: t.owner_name || fallbackOwner || null,
    additional_owners: t.additional_owners?.length ? t.additional_owners : undefined,
    due_date: t.due_at,
    overdue: Boolean(open && t.due_at && t.due_at < today),
    types: t.types?.length ? t.types : t.type ? [t.type] : [],
    ...(t.completed_at ? { completed_at: t.completed_at } : {}),
  };
}

async function getCaseChecklist(args: Record<string, unknown>, { supabase }: McpToolContext) {
  const c = await requireCase(supabase, reqString(args, "case_number"));
  const includeCompleted = optBool(args, "include_completed") ?? false;
  const [{ data: overview, error: oErr }, { data: tasks, error: tErr }] = await Promise.all([
    supabase.from("checklist_case_overview").select("*").eq("case_id", c.id).maybeSingle(),
    supabase
      .from("checklist_tasks")
      .select(TASK_COLUMNS)
      .eq("case_id", c.id)
      .order("stage", { ascending: true })
      .order("sequence", { ascending: true }),
  ]);
  if (oErr) throw oErr;
  if (tErr) throw tErr;
  const today = todayChicagoYmd();
  const rows = (tasks ?? []) as ChecklistTaskRow[];
  const paralegal = (overview?.paralegal_name as string | null) ?? null;
  const active = rows.filter((t) => t.status === "active");
  const upcoming = rows.filter((t) => t.status === "upcoming");
  const done = rows.filter((t) => t.status === "completed" || t.status === "skipped" || t.status === "na");
  return {
    case: caseSummary(c),
    today,
    paralegal,
    attorney: (overview?.attorney_name as string | null) ?? null,
    stage: (overview?.stage as string | null) ?? null,
    risk: (overview?.risk as string | null) ?? null,
    next_action: overview?.next_action
      ? {
          task_id: overview.next_task_id,
          title: overview.next_action,
          owner: overview.next_owner_name ?? paralegal,
          due_date: overview.next_due_at,
          status: overview.next_status,
        }
      : null,
    counts: {
      total: rows.length,
      active: active.length,
      upcoming: upcoming.length,
      completed_or_skipped: done.length,
      overdue: active.filter((t) => t.due_at && t.due_at < today).length,
    },
    active_tasks: active.map((t) => formatTask(t, today, paralegal)),
    upcoming_tasks: upcoming.slice(0, 40).map((t) => formatTask(t, today, paralegal)),
    ...(includeCompleted ? { completed_tasks: done.map((t) => formatTask(t, today, paralegal)) } : {}),
  };
}

async function myOpenTasks(args: Record<string, unknown>, { supabase, caller }: McpToolContext) {
  const overdueOnly = optBool(args, "overdue_only") ?? false;
  const today = todayChicagoYmd();
  const names = new Set(caller.checklistOwnerNames);
  if (!names.size && !caller.authUserId) {
    throw new ToolUserError(`${caller.email} has no checklist profile or DocketFlow contact.`);
  }

  type Row = ChecklistTaskRow & { case: { id: string; client_name: string | null; case_number: string | null } };
  const rows: Row[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from("checklist_tasks")
      .select(`${TASK_COLUMNS}, case:cases!inner(id, client_name, case_number, status)`)
      .eq("status", "active")
      .eq("case.status", "active")
      .order("id")
      .range(from, from + 999);
    if (error) throw error;
    rows.push(...((data ?? []) as unknown as Row[]));
    if ((data ?? []).length < 1000) break;
  }

  const { data: overview, error: oErr } = await supabase
    .from("checklist_case_overview")
    .select("case_id, paralegal_name");
  if (oErr) throw oErr;
  const paralegalByCase = new Map(
    (overview ?? []).map((o) => [o.case_id as string, (o.paralegal_name as string | null) ?? null])
  );

  const isMine = (t: Row) => {
    const owners = [t.owner_name || paralegalByCase.get(t.case_id) || "", ...(t.additional_owners ?? [])];
    return (
      owners.some((o) => o && names.has(o.trim().toLowerCase())) ||
      (caller.authUserId != null && t.owner_id === caller.authUserId)
    );
  };
  const mine = rows
    .filter(isMine)
    .filter((t) => !overdueOnly || (t.due_at && t.due_at < today))
    .sort((a, b) => (a.due_at ?? "9999").localeCompare(b.due_at ?? "9999"));

  return {
    caller: { email: caller.email, matched_owner_names: [...names] },
    today,
    count: mine.length,
    overdue_count: mine.filter((t) => t.due_at && t.due_at < today).length,
    tasks: mine.slice(0, 100).map((t) => ({
      case_number: t.case?.case_number ?? null,
      client: t.case?.client_name ?? null,
      ...formatTask(t, today, paralegalByCase.get(t.case_id) ?? null),
    })),
    ...(mine.length > 100 ? { note: "Showing the 100 soonest-due tasks." } : {}),
  };
}

function sumField(rows: Record<string, unknown>[], key: string): number {
  return Math.round(rows.reduce((acc, r) => acc + (Number(r[key]) || 0), 0) * 100) / 100;
}

async function getMedicalTracker(args: Record<string, unknown>, { supabase }: McpToolContext) {
  const c = await requireCase(supabase, reqString(args, "case_number"));
  const [{ data: providers, error: pErr }, { data: records, error: rErr }] = await Promise.all([
    supabase
      .from("case_medical_tracker")
      .select(
        "provider_name, has_lop, treatment_finished_date, medical_requested_date, medical_received_date, billing_requested_date, billing_received_date"
      )
      .eq("case_id", c.id)
      .order("provider_name"),
    supabase
      .from("case_medical_records")
      .select(
        "provider_name, account_number, date_of_service, original_charges, current_balance, final_pay_amount, reduced_from_amount, payment_status, review_status"
      )
      .eq("case_id", c.id)
      .order("provider_name"),
  ]);
  if (pErr) throw pErr;
  if (rErr) throw rErr;
  const recs = (records ?? []) as Record<string, unknown>[];
  return {
    case: caseSummary(c),
    providers: (providers ?? []).map((p) => ({
      provider: p.provider_name,
      lop: p.has_lop,
      treatment_finished: p.treatment_finished_date,
      records_requested: p.medical_requested_date,
      records_received: p.medical_received_date,
      billing_requested: p.billing_requested_date,
      billing_received: p.billing_received_date,
    })),
    balances: recs.map((r) => ({
      provider: r.provider_name,
      account_number: r.account_number,
      date_of_service: r.date_of_service,
      original_charges: r.original_charges,
      current_balance: r.current_balance,
      final_pay: r.final_pay_amount,
      reduced_from: r.reduced_from_amount,
      payment_status: r.payment_status,
      review_status: r.review_status,
    })),
    totals: {
      original_charges: sumField(recs, "original_charges"),
      current_balance: sumField(recs, "current_balance"),
      final_pay: sumField(recs, "final_pay_amount"),
    },
  };
}

async function getCaseExpenses(args: Record<string, unknown>, { supabase }: McpToolContext) {
  const c = await requireCase(supabase, reqString(args, "case_number"));
  const { data, error } = await supabase
    .from("case_expenses")
    .select(
      "vendor_name, expense_type, description, invoice_number, invoice_date, amount, payment_status, paid_amount, check_number, review_status"
    )
    .eq("case_id", c.id)
    .order("invoice_date", { ascending: true, nullsFirst: false });
  if (error) throw error;
  const rows = (data ?? []) as Record<string, unknown>[];
  const total = sumField(rows, "amount");
  const paid = sumField(rows, "paid_amount");
  return {
    case: caseSummary(c),
    expenses: rows.map((r) => ({
      vendor: r.vendor_name,
      type: r.expense_type,
      description: r.description,
      invoice_number: r.invoice_number,
      invoice_date: r.invoice_date,
      amount: r.amount,
      payment_status: r.payment_status,
      paid_amount: r.paid_amount,
      check_number: r.check_number,
      review_status: r.review_status,
    })),
    totals: { amount: total, paid, unpaid: Math.round((total - paid) * 100) / 100 },
  };
}

/* ── Write tools ────────────────────────────────────────────────── */

/** Same steps as `AddCalendarEventModal.saveNewCalendarEvent` + `/api/calendar/sync` create. */
async function createCaseEvent(args: Record<string, unknown>, { supabase, caller }: McpToolContext) {
  const authUserId = requireWriter(caller);
  const c = await requireCase(supabase, reqString(args, "case_number"));
  if (c.status === "archived") {
    throw new ToolUserError(`${caseDisplayName(c)} is closed. Reopen it in DocketFlow before adding events.`);
  }
  const title = reqString(args, "title");
  const kind = resolveEventKind(reqString(args, "kind"));
  const deponent = optString(args, "deponent_or_subject")?.trim() ?? "";
  if (manualEventNeedsDeponentField(kind) && !deponent) {
    throw new ToolUserError("This kind needs deponent_or_subject (who is being deposed, or the witness).");
  }
  const start = parseWhenArg(args, "start");
  if (!start) throw new ToolUserError("start is required");
  const sched = scheduleFromInputs(start, parseWhenArg(args, "end"));
  const scheduleKindRaw = optString(args, "schedule_kind")?.trim();
  const scheduleKind: EventScheduleKind = scheduleKindRaw === "meeting" ? "meeting" : "deadline";
  if (scheduleKind === "meeting" && !sched.startTime) {
    throw new ToolUserError("Meetings need a start time (e.g. 2026-10-05T14:00).");
  }

  const holidays = await loadFederalHolidays(supabase);
  const holidayErr = validateEventScheduleAgainstFederalHolidays(
    { date: sched.date, deadlineEndDate: sched.deadlineEndDate, startDateTime: sched.startTime ? "set" : null },
    holidays
  );
  if (holidayErr) throw new ToolUserError(holidayErr);

  const contacts = await fetchContactsForUser(supabase, "");
  const contactById = new Map(contacts.map((ct) => [ct.id, ct]));
  const extraIds = matchContactsByName(optStringArray(args, "internal_attendee_names"), contacts).map(
    (ct) => ct.id
  );
  const assigneeEmails = Array.from(
    new Set(
      caseCalendarInviteContactIds(c, extraIds)
        .map((id) => contactById.get(id)?.email?.trim().toLowerCase())
        .filter((e): e is string => Boolean(e))
    )
  );
  const firmWideEmails = contacts
    .filter((ct) => ct.teamCalendarScope === "all_firm_events" && ct.email?.trim())
    .map((ct) => ct.email.trim().toLowerCase());
  const recipients = mergeAttendeeEmailLists(assigneeEmails, firmWideEmails);
  if (!recipients.length) {
    throw new ToolUserError(
      "No calendar recipients: assign contacts with email on the case or name internal attendees."
    );
  }

  const draft = createAdHocCalendarEvent(c.id, authUserId, {
    eventDate: sched.date,
    startTime: null,
    endTime: null,
    eventKind: kind,
    title,
    description: optString(args, "description")?.trim() ?? "",
    category: categoryForManualEventKind(kind),
    deponentOrSubject: deponent || null,
    externalAttendeesText: optString(args, "external_attendees_text")?.trim() || null,
    zoomLink: optString(args, "zoom_link")?.trim() || null,
    remindersMinutes: getFixedRemindersForKind(kind),
    scheduleKind,
    createdByEmail: caller.email,
    deadlineEndDate: sched.deadlineEndDate,
  });
  let ev: CalendarEvent = {
    ...draft,
    ...(extraIds.length ? { extraInternalContactIds: extraIds } : {}),
  };
  if (sched.startTime) {
    const startIso = chicagoLocalToIso(sched.date, sched.startTime);
    const endIso = sched.endTime
      ? chicagoLocalToIso(sched.date, sched.endTime)
      : new Date(new Date(startIso).getTime() + 60 * 60 * 1000).toISOString();
    ev = { ...ev, startDateTime: startIso, endDateTime: endIso, deadlineEndDate: null };
  }

  await saveEvent(supabase, c.id, ev);

  let googleError: string | null = null;
  try {
    const { organizerEventId, idsByEmail } = await insertGoogleEvent({
      summary: `${caseDisplayName(c)} – ${ev.title}`,
      description: `Source: Manual event\n\n${googleCalendarDescription(ev)}`,
      dateIso: ev.date,
      attendeeEmails: recipients,
      reminderMinutes: ev.remindersMinutes,
      startDateTime: ev.startDateTime ?? undefined,
      endDateTime: ev.endDateTime ?? undefined,
      location: ev.zoomLink?.trim() || undefined,
      scheduleKind: ev.scheduleKind,
      deadlineEndDate: ev.startDateTime ? undefined : ev.deadlineEndDate ?? null,
    });
    ev = {
      ...ev,
      googleEventId: organizerEventId,
      ...(Object.keys(idsByEmail).length ? { googleCalendarEventIdsByEmail: idsByEmail } : {}),
    };
    await saveEvent(supabase, c.id, ev);
  } catch (e) {
    googleError = e instanceof Error ? e.message : String(e);
    console.error("[mcp] create_case_event Google insert failed", googleError, e);
  }

  const side = await recordCaseActivity(
    supabase,
    caller,
    authUserId,
    c,
    "event_created",
    `Added "${ev.title}" (${ev.date})`
  );

  return {
    ok: googleError == null,
    event: formatEvent(ev, c, contactById),
    google_calendar: googleError
      ? {
          invites_sent: false,
          error: googleError,
          note: "The event is saved in DocketFlow but has no Google invite yet; an admin can resend it from Calendar → Missing sync.",
        }
      : {
          invites_sent: true,
          recipients,
          delivery:
            ev.scheduleKind === "meeting"
              ? "Meeting invite emailed from the organizer calendar"
              : "Deadline copy placed on each recipient's calendar",
        },
    ...side,
  };
}

/** Same steps as the case page `saveEdit()` + `/api/calendar/sync` update. */
async function updateCaseEvent(args: Record<string, unknown>, { supabase, caller }: McpToolContext) {
  const authUserId = requireWriter(caller);
  const eventId = reqUuid(args, "event_id");
  const existing = await fetchEventById(supabase, eventId);
  if (!existing) throw new ToolUserError(`No DocketFlow event with id ${eventId}.`);
  const c = await fetchCase(supabase, existing.caseId);
  if (!c) throw new ToolUserError("That event's case no longer exists.");

  let updated: CalendarEvent = { ...existing, updatedAt: Date.now() };
  const changes: string[] = [];

  const title = optString(args, "title")?.trim();
  if (title && title !== existing.title) {
    updated.title = title;
    changes.push("title");
  }
  const description = optString(args, "description");
  if (description !== undefined && description.trim() !== (existing.description ?? "").trim()) {
    updated.description = description.trim();
    changes.push("description");
  }
  const zoom = optString(args, "zoom_link");
  if (zoom !== undefined && (zoom.trim() || null) !== (existing.zoomLink?.trim() || null)) {
    updated.zoomLink = zoom.trim() || null;
    changes.push(zoom.trim() ? "zoom link" : "zoom link removed");
  }

  const startArg = parseWhenArg(args, "start");
  const endArg = parseWhenArg(args, "end");
  if (startArg || endArg) {
    const curStart = existing.startDateTime ? isoToChicagoParts(existing.startDateTime) : null;
    const start: ParsedWhen = startArg ?? { date: existing.date, time: curStart?.time ?? null };
    let end = endArg;
    if (!end && !start.time && existing.deadlineEndDate && existing.deadlineEndDate > start.date) {
      end = { date: existing.deadlineEndDate, time: null };
    }
    const sched = scheduleFromInputs(start, end);
    if (updated.scheduleKind === "meeting" && !sched.startTime) {
      throw new ToolUserError("Meetings need a start time on the event date.");
    }
    if (sched.startTime) {
      const startIso = chicagoLocalToIso(sched.date, sched.startTime);
      let endIso: string;
      if (sched.endTime) {
        endIso = chicagoLocalToIso(sched.date, sched.endTime);
      } else {
        const prevDuration =
          existing.startDateTime && existing.endDateTime
            ? new Date(existing.endDateTime).getTime() - new Date(existing.startDateTime).getTime()
            : 0;
        const durationMs = prevDuration > 0 && prevDuration < 24 * 3600 * 1000 ? prevDuration : 3600 * 1000;
        endIso = new Date(new Date(startIso).getTime() + durationMs).toISOString();
      }
      updated = { ...updated, date: sched.date, startDateTime: startIso, endDateTime: endIso, deadlineEndDate: null };
    } else {
      updated = {
        ...updated,
        date: sched.date,
        startDateTime: null,
        endDateTime: null,
        deadlineEndDate: sched.deadlineEndDate,
      };
    }
    const holidays = await loadFederalHolidays(supabase);
    const holidayErr = validateEventScheduleAgainstFederalHolidays(
      { date: updated.date, deadlineEndDate: updated.deadlineEndDate, startDateTime: updated.startDateTime },
      holidays
    );
    if (holidayErr) throw new ToolUserError(holidayErr);
    changes.push("schedule");
  }

  if (!changes.length) throw new ToolUserError("Nothing to change — pass start, end, title, description, or zoom_link.");

  const ek = updated.eventKind ?? "other_event";
  if (isTaxonomyEventKind(ek)) {
    updated = { ...updated, remindersMinutes: [...getFixedRemindersForKind(ek)] };
  }

  await saveEvent(supabase, c.id, updated);

  let googleUpdated = false;
  let googleError: string | null = null;
  if (!isGoogleIcsMirrorEvent(updated) && updated.googleEventId) {
    const description = googleCalendarDescription(updated);
    const location = updated.zoomLink?.trim() ?? "";
    try {
      if (updated.googleHostCalendarId) {
        await patchSolMilestoneGoogleEvent({
          claimedHostCalendarId: updated.googleHostCalendarId,
          googleEventId: updated.googleEventId,
          summary: updated.title,
          description,
          dateIso: updated.startDateTime ? undefined : updated.date,
          startDateTime: updated.startDateTime ?? undefined,
          endDateTime: updated.endDateTime ?? undefined,
          reminderMinutes: updated.remindersMinutes.length ? updated.remindersMinutes : [20160, 10080, 1440],
          location,
        });
      } else {
        const { failedEmails } = await patchGoogleEvent({
          googleEventId: updated.googleEventId,
          idsByEmail:
            updated.googleCalendarEventIdsByEmail &&
            Object.keys(updated.googleCalendarEventIdsByEmail).length > 0
              ? updated.googleCalendarEventIdsByEmail
              : undefined,
          summary: `${caseDisplayName(c)} – ${updated.title}`,
          description,
          dateIso: updated.startDateTime ? undefined : updated.date,
          deadlineEndDate: updated.startDateTime ? undefined : updated.deadlineEndDate ?? null,
          startDateTime: updated.startDateTime ?? undefined,
          endDateTime: updated.endDateTime ?? undefined,
          reminderMinutes: updated.remindersMinutes.length ? updated.remindersMinutes : [20160, 10080, 1440],
          location,
          scheduleKind: updated.scheduleKind,
          ...(updated.googleColorId !== undefined ? { googleColorId: updated.googleColorId } : {}),
        });
        if (failedEmails.length) {
          throw new Error(`Google Calendar rejected the update on: ${failedEmails.join(", ")}`);
        }
      }
      googleUpdated = true;
    } catch (e) {
      googleError = e instanceof Error ? e.message : String(e);
      console.error("[mcp] update_case_event Google patch failed", googleError, e);
    }
  }

  const contacts = await fetchContactsForUser(supabase, "");
  const side = await recordCaseActivity(
    supabase,
    caller,
    authUserId,
    c,
    "event_edited",
    `Edited "${updated.title}" (${updated.date})`
  );
  return {
    ok: googleError == null,
    changed: changes,
    event: formatEvent(updated, c, new Map(contacts.map((ct) => [ct.id, ct]))),
    google_calendar: googleError
      ? { updated: false, error: googleError }
      : { updated: googleUpdated, ...(googleUpdated ? {} : { note: "Event has no Google Calendar invite to update." }) },
    ...side,
  };
}

/** Same as the case page `toggleEventCompleted` (DocketFlow-only flag; Google invite is untouched). */
async function completeCaseEvent(args: Record<string, unknown>, { supabase, caller }: McpToolContext) {
  requireWriter(caller);
  const eventId = reqUuid(args, "event_id");
  const ev = await fetchEventById(supabase, eventId);
  if (!ev) throw new ToolUserError(`No DocketFlow event with id ${eventId}.`);
  const c = await fetchCase(supabase, ev.caseId);
  if (!c) throw new ToolUserError("That event's case no longer exists.");
  if (ev.completed) {
    return { ok: true, already_completed: true, event_id: ev.id, title: ev.title, case: caseSummary(c) };
  }
  await saveEvent(supabase, c.id, { ...ev, completed: true, updatedAt: Date.now() });
  return {
    ok: true,
    event_id: ev.id,
    title: ev.title,
    date: ev.date,
    case: caseSummary(c),
    note: "Marked complete in DocketFlow (no longer shown as overdue). Google Calendar is unchanged, same as the DocketFlow button.",
  };
}

async function fetchTaskWithCase(supabase: SupabaseClient, taskId: string) {
  const { data, error } = await supabase
    .from("checklist_tasks")
    .select(`${TASK_COLUMNS}, case:cases(id, client_name, case_number)`)
    .eq("id", taskId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new ToolUserError(`No checklist task with id ${taskId}.`);
  return data as unknown as ChecklistTaskRow & {
    case: { id: string; client_name: string | null; case_number: string | null } | null;
  };
}

/** Same writes as the checklist app `completeTask` (+ `saveNote` when a note is given). */
async function completeChecklistTask(args: Record<string, unknown>, { supabase, caller }: McpToolContext) {
  const authUserId = requireWriter(caller);
  const taskId = reqUuid(args, "task_id");
  const note = optString(args, "note")?.trim();
  const task = await fetchTaskWithCase(supabase, taskId);
  const caseInfo = { case_number: task.case?.case_number ?? null, client: task.case?.client_name ?? null };
  if (task.status === "completed") {
    return { ok: true, already_completed: true, task_id: task.id, title: task.title, ...caseInfo };
  }
  const since = new Date(Date.now() - 60_000).toISOString();
  const completedAt = new Date().toISOString();
  const { error } = await supabase
    .from("checklist_tasks")
    .update({ status: "completed", completed_at: completedAt, completed_by: authUserId })
    .eq("id", taskId);
  if (error) throw error;
  await stampChecklistEventActor(supabase, taskId, caller, since);

  let noteSaved = false;
  if (note) {
    const { error: nErr } = await supabase.from("checklist_task_notes").insert({
      task_id: taskId,
      body: `${note}${SLACKBOT_SUFFIX}`,
      actor_id: authUserId,
      actor_name: caller.displayName,
    });
    if (nErr) throw nErr;
    noteSaved = true;
  }
  return {
    ok: true,
    task_id: task.id,
    title: task.title,
    ...caseInfo,
    previous_status: task.status,
    status: "completed",
    completed_at: completedAt,
    completed_by: caller.displayName,
    note_saved: noteSaved,
  };
}

/** Same write as the checklist app task drawer owner dropdown (`owner_name`). */
async function reassignChecklistTask(args: Record<string, unknown>, { supabase, caller }: McpToolContext) {
  requireWriter(caller);
  const taskId = reqUuid(args, "task_id");
  const requested = reqString(args, "owner_name");
  const task = await fetchTaskWithCase(supabase, taskId);

  const { data: overview, error: oErr } = await supabase
    .from("checklist_case_overview")
    .select("case_id, paralegal_name, attorney_name");
  if (oErr) throw oErr;
  const staff = new Set<string>();
  for (const o of overview ?? []) {
    if (o.paralegal_name) staff.add(String(o.paralegal_name));
    if (o.case_id === task.case_id && o.attorney_name) staff.add(String(o.attorney_name));
  }
  const staffList = [...staff].sort();
  const q = requested.trim().toLowerCase();
  let hits = staffList.filter((s) => s.toLowerCase() === q);
  if (!hits.length) hits = staffList.filter((s) => s.toLowerCase().split(/\s+/)[0] === q);
  if (hits.length !== 1) {
    throw new ToolUserError(
      hits.length
        ? `"${requested}" matches ${hits.join(", ")} — use the full name.`
        : `"${requested}" is not a checklist owner. Choose one of: ${staffList.join(", ")}`
    );
  }
  const owner = hits[0]!;
  const caseInfo = { case_number: task.case?.case_number ?? null, client: task.case?.client_name ?? null };
  if (task.owner_name === owner) {
    return { ok: true, unchanged: true, task_id: task.id, title: task.title, owner, ...caseInfo };
  }
  const since = new Date(Date.now() - 60_000).toISOString();
  const { error } = await supabase.from("checklist_tasks").update({ owner_name: owner }).eq("id", taskId);
  if (error) throw error;
  await stampChecklistEventActor(supabase, taskId, caller, since);
  return {
    ok: true,
    task_id: task.id,
    title: task.title,
    ...caseInfo,
    previous_owner: task.owner_name,
    owner,
  };
}

/* ── Registry ───────────────────────────────────────────────────── */

const caseNumberProp = {
  type: "string",
  description: "Firm case number, e.g. 12345 (the number in the case's Slack channel / DocketFlow title).",
};
const whenDescription =
  "Date `YYYY-MM-DD` for all-day, or `YYYY-MM-DDTHH:mm` in firm Central time (America/Chicago), e.g. 2026-10-05T14:30.";

export const DOCKETFLOW_MCP_TOOLS: McpToolDefinition[] = [
  {
    name: "list_case_events",
    title: "List case events",
    description:
      "Upcoming and past calendar events for one case (hearings, depositions, mediations, SOL and court deadlines) with date/time (Central), kind, attendees, and Zoom link. Excluded rows are hidden; completed events are hidden unless include_completed is true.",
    inputSchema: {
      type: "object",
      properties: {
        case_number: caseNumberProp,
        from: { type: "string", description: "Optional first date (YYYY-MM-DD)." },
        to: { type: "string", description: "Optional last date (YYYY-MM-DD)." },
        include_completed: { type: "boolean", description: "Include events already marked complete.", default: false },
      },
      required: ["case_number"],
      additionalProperties: false,
    },
    annotations: { title: "List case events", readOnlyHint: true, openWorldHint: false },
    handler: listCaseEvents,
  },
  {
    name: "my_upcoming_events",
    title: "My upcoming events",
    description:
      "Upcoming incomplete events for the person asking: every event on open cases where they are an assignee, the event attorney, or an added internal attendee. scope \"firm\" lists all open cases instead.",
    inputSchema: {
      type: "object",
      properties: {
        days: { type: "integer", minimum: 1, maximum: 90, default: 14, description: "How many days ahead (default 14)." },
        scope: { type: "string", enum: ["mine", "firm"], default: "mine" },
      },
      additionalProperties: false,
    },
    annotations: { title: "My upcoming events", readOnlyHint: true, openWorldHint: false },
    handler: myUpcomingEvents,
  },
  {
    name: "get_case_checklist",
    title: "Get case checklist",
    description:
      "Paralegal checklist for one case: next action, stage, risk, and each task's owner, due date, overdue flag, and status. Use task_id from here with complete_checklist_task / reassign_checklist_task.",
    inputSchema: {
      type: "object",
      properties: {
        case_number: caseNumberProp,
        include_completed: { type: "boolean", default: false, description: "Also list completed / skipped tasks." },
      },
      required: ["case_number"],
      additionalProperties: false,
    },
    annotations: { title: "Get case checklist", readOnlyHint: true, openWorldHint: false },
    handler: getCaseChecklist,
  },
  {
    name: "my_open_tasks",
    title: "My open tasks",
    description:
      "The asking person's active checklist tasks across open cases (tasks they own, co-own, or that default to them as case paralegal), soonest due first, with overdue flags.",
    inputSchema: {
      type: "object",
      properties: { overdue_only: { type: "boolean", default: false } },
      additionalProperties: false,
    },
    annotations: { title: "My open tasks", readOnlyHint: true, openWorldHint: false },
    handler: myOpenTasks,
  },
  {
    name: "get_medical_tracker",
    title: "Get medical tracker",
    description:
      "Medical providers for a case (LOP, treatment finished, records and billing requested/received dates) plus medical record balances (original charges, current balance, final pay) and totals.",
    inputSchema: {
      type: "object",
      properties: { case_number: caseNumberProp },
      required: ["case_number"],
      additionalProperties: false,
    },
    annotations: { title: "Get medical tracker", readOnlyHint: true, openWorldHint: false },
    handler: getMedicalTracker,
  },
  {
    name: "get_case_expenses",
    title: "Get case expenses",
    description: "Case expenses with vendor, amount, payment status, paid amount, and invoice date, plus totals.",
    inputSchema: {
      type: "object",
      properties: { case_number: caseNumberProp },
      required: ["case_number"],
      additionalProperties: false,
    },
    annotations: { title: "Get case expenses", readOnlyHint: true, openWorldHint: false },
    handler: getCaseExpenses,
  },
  {
    name: "create_case_event",
    title: "Create case event",
    description:
      "Add an event to a case exactly like DocketFlow's Add event dialog: saves it, sends Google Calendar invites to the case team (plus named internal attendees and firm-wide contacts), schedules reminders for the kind, logs activity, and posts to the case Slack channel. Confirm details with the user before calling.",
    inputSchema: {
      type: "object",
      properties: {
        case_number: caseNumberProp,
        title: { type: "string", description: "Event title (the case name is prefixed automatically in Google)." },
        kind: {
          type: "string",
          enum: TAXONOMY_KINDS.map((k) => k.value),
          description: `Event type (sets category and fixed reminders). ${TAXONOMY_KINDS.map((k) => `${k.value} = ${k.label}`).join("; ")}`,
        },
        start: { type: "string", description: whenDescription },
        end: {
          type: "string",
          description:
            "Optional. Timed events: same-day end time (YYYY-MM-DDTHH:mm, default +1 hour). All-day deadlines: last day (YYYY-MM-DD) for a multi-day span.",
        },
        schedule_kind: {
          type: "string",
          enum: ["deadline", "meeting"],
          default: "deadline",
          description:
            "deadline (default): a copy is placed on each person's calendar. meeting: one invite emailed to attendees from the organizer; needs a start time.",
        },
        description: { type: "string" },
        zoom_link: { type: "string", description: "Zoom / video link (also used as the Google location)." },
        deponent_or_subject: { type: "string", description: "Who is being deposed / subject. Required for scheduling_deposition_deadline." },
        internal_attendee_names: {
          type: "array",
          items: { type: "string" },
          description: "Extra DocketFlow contacts to invite by name (case assignees are always invited).",
        },
        external_attendees_text: { type: "string", description: "Outside parties (free text, shown in the invite)." },
      },
      required: ["case_number", "title", "kind", "start"],
      additionalProperties: false,
    },
    annotations: { title: "Create case event", readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    handler: createCaseEvent,
  },
  {
    name: "update_case_event",
    title: "Update case event",
    description:
      "Reschedule or edit an event (title, description, Zoom link) like DocketFlow's Edit event: saves it, updates every Google Calendar copy/invite, logs activity, and posts to the case Slack channel. Get event_id from list_case_events or my_upcoming_events.",
    inputSchema: {
      type: "object",
      properties: {
        event_id: { type: "string" },
        start: { type: "string", description: `New start. ${whenDescription} A date without a time makes it all-day.` },
        end: { type: "string", description: "New same-day end time, or last day for a multi-day all-day deadline." },
        title: { type: "string" },
        description: { type: "string", description: "Replaces the description." },
        zoom_link: { type: "string", description: "New link; empty string removes it." },
      },
      required: ["event_id"],
      additionalProperties: false,
    },
    annotations: { title: "Update case event", readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    handler: updateCaseEvent,
  },
  {
    name: "complete_case_event",
    title: "Complete case event",
    description:
      "Mark an event complete (same as the DocketFlow checkbox) so it no longer shows as overdue. Does not change Google Calendar.",
    inputSchema: {
      type: "object",
      properties: { event_id: { type: "string" } },
      required: ["event_id"],
      additionalProperties: false,
    },
    annotations: { title: "Complete case event", readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    handler: completeCaseEvent,
  },
  {
    name: "complete_checklist_task",
    title: "Complete checklist task",
    description:
      "Mark a checklist task completed (same as the checklist app's Complete button), optionally adding a note. Get task_id from get_case_checklist or my_open_tasks.",
    inputSchema: {
      type: "object",
      properties: {
        task_id: { type: "string" },
        note: { type: "string", description: "Optional note saved on the task." },
      },
      required: ["task_id"],
      additionalProperties: false,
    },
    annotations: { title: "Complete checklist task", readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    handler: completeChecklistTask,
  },
  {
    name: "reassign_checklist_task",
    title: "Reassign checklist task",
    description:
      "Change a checklist task's owner (same as the checklist app's Owner dropdown). owner_name must be a checklist staff member (case paralegals or the case attorney).",
    inputSchema: {
      type: "object",
      properties: {
        task_id: { type: "string" },
        owner_name: { type: "string", description: "Staff name, e.g. Lyliana or Dina Flores." },
      },
      required: ["task_id", "owner_name"],
      additionalProperties: false,
    },
    annotations: { title: "Reassign checklist task", readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    handler: reassignChecklistTask,
  },
];
