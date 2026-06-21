import type { SupabaseClient, RealtimeChannel } from "@supabase/supabase-js";
import type {
  ActivityAction,
  ActivityEntry,
  CalendarEvent,
  Case,
  Contact,
  CaseSlackChannel,
  EventCategory,
  EventKind,
} from "@/lib/types";
import { caseDisplayName, caseNumberLookupKeys } from "@/lib/case-display";
import type { CaseTrackerPipeline } from "@/lib/case-tracker-pipeline";
import { normalizeGoogleCalendarInviteColorId } from "@/lib/google-calendar-invite-colors";

type Unsubscribe = () => void;

function clean<T extends Record<string, unknown>>(obj: T): T {
  return Object.fromEntries(
    Object.entries(obj).filter(([, v]) => v !== undefined)
  ) as T;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function formatSupabaseWriteError(context: string, err: { message?: string; details?: string; hint?: string; code?: string }): string {
  const parts = [err.message, err.details, err.hint].filter(Boolean);
  const base = parts.join(" — ") || "Unknown error";
  return err.code ? `${context} (${err.code}): ${base}` : `${context}: ${base}`;
}

function normalizeDeadlineEndForDb(startYmd: string, raw: string | null | undefined): string | null {
  if (raw == null || String(raw).trim() === "") return null;
  const e = String(raw).trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(e)) return null;
  if (e < startYmd) return null;
  if (e === startYmd) return null;
  return e;
}

/** Coerce app state → DB-safe row (avoids PostgREST 400s from null NOT NULL, bad arrays, invalid uuid[]). */
function eventToRow(ev: CalendarEvent, ownerId: string): Record<string, unknown> {
  const now = Date.now();
  const createdAt = Number.isFinite(ev.createdAt) && ev.createdAt > 0 ? ev.createdAt : now;
  const updatedAt = Number.isFinite(ev.updatedAt) && ev.updatedAt > 0 ? ev.updatedAt : now;
  const scheduleKind = ev.scheduleKind === "meeting" ? "meeting" : "deadline";
  const origin = ev.calendarOrigin === "google_ics_mirror" ? "google_ics_mirror" : "docketflow";
  const reminders = (ev.remindersMinutes ?? [])
    .map((m) => Math.round(Number(m)))
    .filter((m) => Number.isFinite(m) && m >= 0);
  const emailSent = (ev.emailRemindersSent ?? [])
    .map((m) => Math.round(Number(m)))
    .filter((m) => Number.isFinite(m) && m >= 0);
  const extraIds =
    ev.extraInternalContactIds?.filter((id) => typeof id === "string" && UUID_RE.test(id.trim())) ?? [];
  return clean({
    id: ev.id,
    case_id: ev.caseId,
    user_id: ownerId,
    title: (ev.title ?? "").trim() || "Untitled event",
    date: ev.date,
    schedule_kind: scheduleKind,
    description: typeof ev.description === "string" ? ev.description : "",
    category: ev.category ?? "other",
    event_kind: ev.eventKind ?? null,
    start_date_time: ev.startDateTime ?? null,
    end_date_time: ev.endDateTime ?? null,
    deadline_end_date: normalizeDeadlineEndForDb(ev.date, ev.deadlineEndDate ?? undefined),
    deponent_or_subject: ev.deponentOrSubject ?? null,
    external_attendees_text: ev.externalAttendeesText ?? null,
    extra_internal_contact_ids: extraIds.length ? extraIds : null,
    zoom_link: ev.zoomLink ?? null,
    priority: ev.priority ?? null,
    calendar_origin: origin,
    google_event_id: ev.googleEventId?.trim() || null,
    google_calendar_event_ids_by_email: ev.googleCalendarEventIdsByEmail ?? null,
    google_host_calendar_id: ev.googleHostCalendarId?.trim() || null,
    included: ev.included !== false,
    completed: Boolean(ev.completed),
    group_suggested: Boolean(ev.groupSuggested),
    group_id: ev.groupId ?? null,
    merge_with_same_group: Boolean(ev.mergeWithSameGroup),
    noise_flag: Boolean(ev.noiseFlag),
    noise_reason: ev.noiseReason ?? null,
    reminders_minutes: reminders,
    email_reminders_sent: emailSent.length ? emailSent : null,
    created_by_email: ev.createdByEmail?.trim() || null,
    google_color_id: normalizeGoogleCalendarInviteColorId(ev.googleColorId ?? undefined) ?? null,
    created_at: createdAt,
    updated_at: updatedAt,
  });
}

/* ── Row mappers ─────────────────────────────────────────────────── */

function caseFromRow(r: Record<string, unknown>): Case {
  return {
    id: r.id as string,
    ownerId: r.user_id as string,
    name: r.name as string,
    clientName: r.client_name as string,
    caseNumber: (r.case_number as string) ?? null,
    causeNumber: (r.cause_number as string) ?? null,
    court: (r.court as string) ?? null,
    dateOfIncident: (r.date_of_incident as string) ?? null,
    dateOfBirth: (r.date_of_birth as string) ?? null,
    notes: (r.notes as string) ?? null,
    caseType: (r.case_type as string) ?? null,
    status: r.status as Case["status"],
    documentUrl: (r.document_url as string) ?? undefined,
    documentFileName: (r.document_file_name as string) ?? undefined,
    assignedContactIds: ((r.assigned_contact_ids as string[]) ?? []).map(String),
    responsibleAttorneyContactId: (r.responsible_attorney_contact_id as string) ?? null,
    eventAttorneyContactId: (r.event_attorney_contact_id as string) ?? null,
    createdAt: Number(r.created_at),
    updatedAt: Number(r.updated_at),
  };
}

function eventFromRow(r: Record<string, unknown>): CalendarEvent {
  const gc = normalizeGoogleCalendarInviteColorId(
    (r.google_color_id as string | null | undefined) ?? undefined
  );
  const startYmd = r.date as string;
  const rawEnd = (r.deadline_end_date as string | null | undefined)?.trim()?.slice(0, 10);
  const deadlineEnd =
    rawEnd && /^\d{4}-\d{2}-\d{2}$/.test(rawEnd) && rawEnd > startYmd ? rawEnd : undefined;
  return {
    id: r.id as string,
    caseId: r.case_id as string,
    ownerId: r.user_id as string,
    title: r.title as string,
    date: r.date as string,
    scheduleKind: r.schedule_kind === "meeting" ? "meeting" : "deadline",
    description: (r.description as string) ?? "",
    category: r.category as EventCategory,
    eventKind: (r.event_kind as EventKind) ?? undefined,
    startDateTime: (r.start_date_time as string) ?? null,
    endDateTime: (r.end_date_time as string) ?? null,
    ...(deadlineEnd ? { deadlineEndDate: deadlineEnd } : {}),
    deponentOrSubject: (r.deponent_or_subject as string) ?? null,
    externalAttendeesText: (r.external_attendees_text as string) ?? null,
    extraInternalContactIds: (r.extra_internal_contact_ids as string[]) ?? undefined,
    zoomLink: (r.zoom_link as string) ?? null,
    priority: (r.priority as CalendarEvent["priority"]) ?? undefined,
    calendarOrigin: (r.calendar_origin as CalendarEvent["calendarOrigin"]) ?? "docketflow",
    googleEventId: (r.google_event_id as string) ?? undefined,
    googleCalendarEventIdsByEmail:
      (r.google_calendar_event_ids_by_email as Record<string, string>) ?? undefined,
    googleHostCalendarId: (r.google_host_calendar_id as string) ?? undefined,
    included: Boolean(r.included),
    completed: Boolean(r.completed),
    groupSuggested: Boolean(r.group_suggested),
    groupId: (r.group_id as string) ?? undefined,
    mergeWithSameGroup: Boolean(r.merge_with_same_group),
    noiseFlag: Boolean(r.noise_flag),
    noiseReason: (r.noise_reason as string) ?? undefined,
    remindersMinutes: (r.reminders_minutes as number[]) ?? [],
    emailRemindersSent: (r.email_reminders_sent as number[]) ?? undefined,
    createdByEmail: (r.created_by_email as string | null | undefined) ?? null,
    ...(gc ? { googleColorId: gc } : {}),
    createdAt: Number(r.created_at),
    updatedAt: Number(r.updated_at),
  };
}

function contactFromRow(r: Record<string, unknown>): Contact {
  const scope = r.team_calendar_scope as string | undefined;
  const teamCalendarScope: Contact["teamCalendarScope"] =
    scope === "all_firm_events" ? "all_firm_events" : "assigned_cases";
  return {
    id: r.id as string,
    ownerId: r.user_id as string,
    name: r.name as string,
    email: r.email as string,
    role: r.role as Contact["role"],
    teamCalendarScope,
    createdAt: Number(r.created_at),
    updatedAt: Number(r.updated_at),
  };
}

function activityFromRow(r: Record<string, unknown>): ActivityEntry {
  return {
    id: r.id as string,
    caseId: (r.case_id as string) ?? undefined,
    caseName: (r.case_name as string) ?? undefined,
    action: r.action as ActivityAction,
    description: r.description as string,
    userEmail: r.user_email as string,
    createdAt: Number(r.created_at),
  };
}

/* ── Cases ───────────────────────────────────────────────────────── */

export async function fetchCase(
  supabase: SupabaseClient,
  caseId: string
): Promise<Case | null> {
  const { data, error } = await supabase
    .from("cases")
    .select("*")
    .eq("id", caseId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return caseFromRow(data as Record<string, unknown>);
}

/** Find an existing case whose `case_number` or `cause_number` matches (normalized variants). */
export async function findCaseByCaseNumber(
  supabase: SupabaseClient,
  caseNumber: string
): Promise<Case | null> {
  const trimmed = caseNumber.trim();
  if (!trimmed) return null;
  const keys = caseNumberLookupKeys({ caseNumber: trimmed, causeNumber: trimmed });
  if (!keys.length) return null;

  const { data, error } = await supabase
    .from("cases")
    .select("*")
    .or(`case_number.in.(${keys.join(",")}),cause_number.in.(${keys.join(",")})`)
    .limit(1);
  if (error) throw error;
  if (!data?.length) return null;
  return caseFromRow(data[0] as Record<string, unknown>);
}

function slackChannelFromRow(r: Record<string, unknown>): CaseSlackChannel {
  return {
    caseNumber: String(r.case_number ?? ""),
    slackChannelId: String(r.slack_channel_id ?? ""),
    slackChannelName: (r.slack_channel_name as string | null) ?? null,
  };
}

/** Lookup Slack channel for a case by `case_number` (tries normalized case number variants). */
export async function fetchSlackChannelForCase(
  supabase: SupabaseClient,
  caseRecord: Pick<Case, "caseNumber" | "causeNumber">
): Promise<CaseSlackChannel | null> {
  const candidates = caseNumberLookupKeys(caseRecord);
  if (candidates.length === 0) return null;

  const { data, error } = await supabase
    .from("case_slack_channels")
    .select("case_number, slack_channel_id, slack_channel_name")
    .in("case_number", candidates)
    .limit(10);
  if (error) throw error;
  if (!data?.length) return null;

  const byKey = new Map(
    data.map((row) => [String((row as { case_number: string }).case_number), row])
  );
  for (const key of candidates) {
    const row = byKey.get(key);
    if (row) return slackChannelFromRow(row as Record<string, unknown>);
  }
  return slackChannelFromRow(data[0] as Record<string, unknown>);
}

export function subscribeCase(
  supabase: SupabaseClient,
  caseId: string,
  cb: (c: Case | null) => void
): Unsubscribe {
  const load = async () => {
    const c = await fetchCase(supabase, caseId);
    cb(c);
  };
  void load();
  const ch: RealtimeChannel = supabase
    .channel(`case:${caseId}`)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "cases", filter: `id=eq.${caseId}` },
      () => {
        void load();
      }
    )
    .subscribe();
  return () => {
    void supabase.removeChannel(ch);
  };
}

/** All firm cases (RLS is company-wide; `userId` is unused, kept for call-site stability). */
export async function fetchCasesForUser(
  supabase: SupabaseClient,
  _userId: string
): Promise<Case[]> {
  const { data, error } = await supabase
    .from("cases")
    .select("*")
    .order("updated_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((r) => caseFromRow(r as Record<string, unknown>));
}

/** `cases` table changes — caller refetches bundled data (e.g. `fetchCasesWithEvents`). */
export function subscribeCases(
  supabase: SupabaseClient,
  _userId: string,
  onChange: () => void
): Unsubscribe {
  const notify = () => {
    try {
      onChange();
    } catch (e) {
      console.warn("[subscribeCases]", e);
    }
  };
  const lane =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `r${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const ch = supabase
    .channel(`cases:firm:${lane}`)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "cases" },
      () => {
        notify();
      }
    )
    .subscribe();
  return () => {
    void supabase.removeChannel(ch);
  };
}

/**
 * Fire when any firm-visible case_events row changes (insert/update/delete).
 * Use with `fetchCasesWithEvents` so list UIs stay in sync — `subscribeCases` alone
 * only reacts to the `cases` table, so SOL milestones and other event writes were
 * invisible until a full navigation or case row update.
 */
export function subscribeCaseEventsFirm(
  supabase: SupabaseClient,
  _userId: string,
  onChange: () => void
): Unsubscribe {
  const lane =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `r${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const ch = supabase
    .channel(`case_events:firm:${lane}`)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "case_events" },
      () => {
        onChange();
      }
    )
    .subscribe();
  return () => {
    void supabase.removeChannel(ch);
  };
}

/** Max case IDs per `in(...)` query — avoids huge URLs and keeps PostgREST happy. */
const CASE_IDS_IN_CHUNK = 150;

/**
 * PostgREST/Supabase caps each response (often 1000 rows). Without paging, a firm-wide
 * `case_events` query ordered by date returns only the earliest slice — newer rows
 * (e.g. SOL milestones on active cases) never appear, so case lists show "0 events".
 */
const POSTGREST_PAGE_SIZE = 1000;

async function fetchAllCaseEventRowsForCaseIds(
  supabase: SupabaseClient,
  caseIds: string[]
): Promise<Record<string, unknown>[]> {
  if (!caseIds.length) return [];
  const acc: Record<string, unknown>[] = [];
  let from = 0;
  for (;;) {
    const { data, error } = await supabase
      .from("case_events")
      .select("*")
      .in("case_id", caseIds)
      .order("date", { ascending: true })
      .order("id", { ascending: true })
      .range(from, from + POSTGREST_PAGE_SIZE - 1);
    if (error) throw error;
    const page = (data ?? []) as Record<string, unknown>[];
    for (const r of page) acc.push(r);
    if (page.length < POSTGREST_PAGE_SIZE) break;
    from += POSTGREST_PAGE_SIZE;
  }
  return acc;
}

export async function fetchCasesWithEvents(
  supabase: SupabaseClient,
  userId: string
): Promise<{ case: Case; events: CalendarEvent[] }[]> {
  const cases = await fetchCasesForUser(supabase, userId);
  if (!cases.length) return [];

  const eventsByCaseId = new Map<string, CalendarEvent[]>();
  for (const c of cases) eventsByCaseId.set(c.id, []);

  const caseIds = cases.map((c) => c.id);
  for (let i = 0; i < caseIds.length; i += CASE_IDS_IN_CHUNK) {
    const chunk = caseIds.slice(i, i + CASE_IDS_IN_CHUNK);
    const rows = await fetchAllCaseEventRowsForCaseIds(supabase, chunk);
    for (const r of rows) {
      const ev = eventFromRow(r);
      const list = eventsByCaseId.get(ev.caseId);
      if (list) list.push(ev);
    }
  }

  for (const list of eventsByCaseId.values()) {
    list.sort((a, b) => a.date.localeCompare(b.date));
  }

  return cases.map((c) => ({ case: c, events: eventsByCaseId.get(c.id) ?? [] }));
}

/** Tracker stage + disbursement for pipeline active/closed filters (Case Tracker tables). */
export async function fetchCaseTrackerPipelineByCaseIds(
  supabase: SupabaseClient,
  caseIds: string[]
): Promise<Map<string, CaseTrackerPipeline>> {
  const out = new Map<string, CaseTrackerPipeline>();
  if (!caseIds.length) return out;

  for (let i = 0; i < caseIds.length; i += CASE_IDS_IN_CHUNK) {
    const chunk = caseIds.slice(i, i + CASE_IDS_IN_CHUNK);
    const [entriesRes, resultsRes] = await Promise.all([
      supabase.from("case_tracker_entries").select("case_id, case_stage").in("case_id", chunk),
      supabase
        .from("case_tracker_results")
        .select("case_id, disbursed_status, check_disbursed_at")
        .in("case_id", chunk),
    ]);
    if (entriesRes.error) throw entriesRes.error;
    if (resultsRes.error) throw resultsRes.error;

    for (const row of entriesRes.data ?? []) {
      const caseId = String((row as { case_id: string }).case_id);
      const existing = out.get(caseId) ?? {
        caseStage: null,
        disbursedStatus: null,
        checkDisbursedAt: null,
      };
      existing.caseStage = ((row as { case_stage: string | null }).case_stage ?? null) as string | null;
      out.set(caseId, existing);
    }
    for (const row of resultsRes.data ?? []) {
      const caseId = String((row as { case_id: string }).case_id);
      const existing = out.get(caseId) ?? {
        caseStage: null,
        disbursedStatus: null,
        checkDisbursedAt: null,
      };
      existing.disbursedStatus =
        ((row as { disbursed_status: string | null }).disbursed_status ?? null) as string | null;
      existing.checkDisbursedAt =
        ((row as { check_disbursed_at: string | null }).check_disbursed_at ?? null) as string | null;
      out.set(caseId, existing);
    }
  }

  return out;
}

/** Create or update Case Tracker intake fields on `case_tracker_entries`. */
export async function upsertCaseTrackerEntryFields(
  supabase: SupabaseClient,
  caseId: string,
  fields: { injuries: string; caseDescription: string },
  userId?: string
): Promise<void> {
  const injuries = fields.injuries.trim();
  const caseDescription = fields.caseDescription.trim();
  const { data: existing, error: lookupErr } = await supabase
    .from("case_tracker_entries")
    .select("id")
    .eq("case_id", caseId)
    .maybeSingle();
  if (lookupErr) throw lookupErr;

  if (existing) {
    const { error } = await supabase
      .from("case_tracker_entries")
      .update(
        clean({
          injuries,
          case_description: caseDescription,
          updated_by: userId ?? null,
        })
      )
      .eq("case_id", caseId);
    if (error) throw error;
    return;
  }

  const { error } = await supabase.from("case_tracker_entries").insert(
    clean({
      case_id: caseId,
      injuries,
      case_description: caseDescription,
      case_stage: "Intake",
      created_by: userId ?? null,
      updated_by: userId ?? null,
    })
  );
  if (error) throw error;
}

export async function fetchEventsForCase(
  supabase: SupabaseClient,
  caseId: string
): Promise<CalendarEvent[]> {
  const acc: CalendarEvent[] = [];
  let from = 0;
  for (;;) {
    const { data, error } = await supabase
      .from("case_events")
      .select("*")
      .eq("case_id", caseId)
      .order("date", { ascending: true })
      .order("id", { ascending: true })
      .range(from, from + POSTGREST_PAGE_SIZE - 1);
    if (error) throw error;
    const page = data ?? [];
    for (const r of page) acc.push(eventFromRow(r as Record<string, unknown>));
    if (page.length < POSTGREST_PAGE_SIZE) break;
    from += POSTGREST_PAGE_SIZE;
  }
  return acc;
}

/** Case fields joined for firm-wide calendar views */
export type CaseCalendarMeta = Pick<
  Case,
  "id" | "name" | "clientName" | "assignedContactIds" | "status"
>;

export type EventWithCaseRow = { event: CalendarEvent; case: CaseCalendarMeta };

function caseCalendarMetaFromRow(r: Record<string, unknown>): CaseCalendarMeta {
  return {
    id: r.id as string,
    name: r.name as string,
    clientName: r.client_name as string,
    assignedContactIds: ((r.assigned_contact_ids as string[]) ?? []).map(String),
    status: r.status as Case["status"],
  };
}

/** Events whose span overlaps [startDate, endDate] (inclusive), with parent case row. */
export async function fetchEventsInDateRange(
  supabase: SupabaseClient,
  _userId: string,
  startDate: string,
  endDate: string
): Promise<EventWithCaseRow[]> {
  const select = "*, cases (id, name, client_name, assigned_contact_ids, status)";
  const seen = new Set<string>();
  const acc: EventWithCaseRow[] = [];

  const pushPage = (page: Record<string, unknown>[]) => {
    for (const raw of page) {
      const row = raw as Record<string, unknown>;
      const id = row.id as string;
      if (seen.has(id)) continue;
      seen.add(id);
      const nested = row.cases as Record<string, unknown> | Record<string, unknown>[] | null | undefined;
      const cRow = Array.isArray(nested) ? nested[0] : nested;
      if (!cRow) continue;
      acc.push({ event: eventFromRow(row), case: caseCalendarMetaFromRow(cRow) });
    }
  };

  for (const base of [
    () =>
      supabase.from("case_events").select(select).gte("date", startDate).lte("date", endDate),
    () =>
      supabase
        .from("case_events")
        .select(select)
        .not("deadline_end_date", "is", null)
        .lt("date", startDate)
        .gte("deadline_end_date", startDate)
        .lte("date", endDate),
  ]) {
    let from = 0;
    for (;;) {
      const { data, error } = await base()
        .order("date", { ascending: true })
        .order("id", { ascending: true })
        .range(from, from + POSTGREST_PAGE_SIZE - 1);
      if (error) throw error;
      const page = (data ?? []) as Record<string, unknown>[];
      pushPage(page);
      if (page.length < POSTGREST_PAGE_SIZE) break;
      from += POSTGREST_PAGE_SIZE;
    }
  }

  acc.sort((a, b) => {
    const d = a.event.date.localeCompare(b.event.date);
    if (d !== 0) return d;
    return a.event.id.localeCompare(b.event.id);
  });
  return acc;
}

export function subscribeEvents(
  supabase: SupabaseClient,
  caseId: string,
  cb: (events: CalendarEvent[]) => void
): Unsubscribe {
  const load = async () => {
    try {
      const list = await fetchEventsForCase(supabase, caseId);
      cb(list);
    } catch (e) {
      console.warn("[subscribeEvents]", e);
      cb([]);
    }
  };
  void load();
  const ch = supabase
    .channel(`case_events:${caseId}`)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "case_events", filter: `case_id=eq.${caseId}` },
      () => {
        void load();
      }
    )
    .subscribe();
  return () => {
    void supabase.removeChannel(ch);
  };
}

export async function createCase(
  supabase: SupabaseClient,
  ownerId: string,
  input: Omit<
    Case,
    "id" | "ownerId" | "createdAt" | "updatedAt" | "assignedContactIds" | "status"
  > & {
    assignedContactIds?: string[];
    responsibleAttorneyContactId?: string | null;
    eventAttorneyContactId?: string | null;
  }
): Promise<string> {
  const cn = input.caseNumber?.trim();
  if (cn) {
    const existing = await findCaseByCaseNumber(supabase, cn);
    if (existing) {
      const num = existing.caseNumber?.trim() || existing.causeNumber?.trim() || cn;
      throw new Error(`Case number ${num} already exists (${caseDisplayName(existing)}).`);
    }
  }

  const now = Date.now();
  const row = clean({
    user_id: ownerId,
    name: input.name.trim(),
    client_name: input.clientName.trim(),
    case_number: input.caseNumber?.trim() || null,
    cause_number: input.causeNumber?.trim() || null,
    court: input.court?.trim() || null,
    date_of_incident: input.dateOfIncident?.trim() || null,
    date_of_birth: input.dateOfBirth?.trim() || null,
    notes: input.notes?.trim() || null,
    case_type: input.caseType?.trim() || null,
    status: "active" as const,
    document_url: input.documentUrl ?? null,
    document_file_name: input.documentFileName ?? null,
    assigned_contact_ids: (input.assignedContactIds ?? []).filter(Boolean),
    responsible_attorney_contact_id: input.responsibleAttorneyContactId?.trim() || null,
    event_attorney_contact_id: input.eventAttorneyContactId?.trim() || null,
    created_at: now,
    updated_at: now,
  });
  const { data, error } = await supabase.from("cases").insert(row).select("id").single();
  if (error) throw error;
  return data.id as string;
}

export async function updateCase(
  supabase: SupabaseClient,
  caseId: string,
  patch: Partial<Omit<Case, "id" | "ownerId">>
): Promise<void> {
  const row: Record<string, unknown> = { updated_at: Date.now() };
  if (patch.name !== undefined) row.name = patch.name;
  if (patch.clientName !== undefined) row.client_name = patch.clientName;
  if (patch.caseNumber !== undefined) row.case_number = patch.caseNumber;
  if (patch.causeNumber !== undefined) row.cause_number = patch.causeNumber;
  if (patch.court !== undefined) row.court = patch.court;
  if (patch.dateOfIncident !== undefined) row.date_of_incident = patch.dateOfIncident;
  if (patch.dateOfBirth !== undefined) row.date_of_birth = patch.dateOfBirth;
  if (patch.notes !== undefined) row.notes = patch.notes;
  if (patch.caseType !== undefined) row.case_type = patch.caseType;
  if (patch.status !== undefined) row.status = patch.status;
  if (patch.documentUrl !== undefined) row.document_url = patch.documentUrl;
  if (patch.documentFileName !== undefined) row.document_file_name = patch.documentFileName;
  if (patch.assignedContactIds !== undefined)
    row.assigned_contact_ids = patch.assignedContactIds.filter(Boolean);
  if (patch.responsibleAttorneyContactId !== undefined)
    row.responsible_attorney_contact_id = patch.responsibleAttorneyContactId?.trim() || null;
  if (patch.eventAttorneyContactId !== undefined)
    row.event_attorney_contact_id = patch.eventAttorneyContactId?.trim() || null;
  const { error } = await supabase.from("cases").update(row).eq("id", caseId);
  if (error) throw error;
}

export async function deleteCaseCascade(
  supabase: SupabaseClient,
  caseId: string
): Promise<void> {
  const { error } = await supabase.from("cases").delete().eq("id", caseId);
  if (error) throw error;
}

export async function setEventsForCase(
  supabase: SupabaseClient,
  caseId: string,
  ownerId: string,
  events: CalendarEvent[]
): Promise<void> {
  if (!events.length) return;
  const rows = events.map((e) => eventToRow({ ...e, caseId, ownerId }, ownerId));
  const { error } = await supabase.from("case_events").upsert(rows, { onConflict: "id" });
  if (error) throw new Error(formatSupabaseWriteError("case_events upsert", error));
}

export async function saveEvent(
  supabase: SupabaseClient,
  caseId: string,
  event: CalendarEvent
): Promise<void> {
  const row = eventToRow(
    { ...event, caseId, updatedAt: Date.now() },
    event.ownerId
  );
  const { error } = await supabase.from("case_events").upsert(row, { onConflict: "id" });
  if (error) throw new Error(formatSupabaseWriteError("case_events save", error));
}

export async function clearEventGoogleCalendarFields(
  supabase: SupabaseClient,
  caseId: string,
  eventId: string
): Promise<void> {
  const { error } = await supabase
    .from("case_events")
    .update({
      google_event_id: null,
      google_calendar_event_ids_by_email: null,
      google_host_calendar_id: null,
      updated_at: Date.now(),
    })
    .eq("id", eventId)
    .eq("case_id", caseId);
  if (error) throw error;
}

export async function deleteEvent(
  supabase: SupabaseClient,
  caseId: string,
  eventId: string
): Promise<void> {
  const { error } = await supabase
    .from("case_events")
    .delete()
    .eq("id", eventId)
    .eq("case_id", caseId);
  if (error) throw error;
}

/* ── Contacts ─────────────────────────────────────────────────────── */

/** All firm contacts (`userId` unused). */
export async function fetchContactsForUser(
  supabase: SupabaseClient,
  _userId: string
): Promise<Contact[]> {
  const { data, error } = await supabase
    .from("contacts")
    .select("*")
    .order("name");
  if (error) throw error;
  return (data ?? []).map((r) => contactFromRow(r as Record<string, unknown>));
}

export function subscribeContacts(
  supabase: SupabaseClient,
  _userId: string,
  cb: (contacts: Contact[]) => void
): Unsubscribe {
  const load = async () => {
    try {
      const list = await fetchContactsForUser(supabase, _userId);
      cb(list);
    } catch (e) {
      console.warn("[subscribeContacts]", e);
      cb([]);
    }
  };
  void load();
  const lane =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `r${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const ch = supabase
    .channel(`contacts:firm:${lane}`)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "contacts" },
      () => {
        void load();
      }
    )
    .subscribe();
  return () => {
    void supabase.removeChannel(ch);
  };
}

export async function addContact(
  supabase: SupabaseClient,
  ownerId: string,
  input: Omit<Contact, "id" | "ownerId" | "createdAt" | "updatedAt">
): Promise<string> {
  const now = Date.now();
  const row = clean({
    user_id: ownerId,
    name: input.name.trim(),
    email: input.email.trim(),
    role: input.role,
    team_calendar_scope: input.teamCalendarScope ?? "assigned_cases",
    created_at: now,
    updated_at: now,
  });
  const { data, error } = await supabase.from("contacts").insert(row).select("id").single();
  if (error) throw error;
  return data.id as string;
}

export async function updateContact(
  supabase: SupabaseClient,
  contactId: string,
  patch: Partial<Omit<Contact, "id" | "ownerId">>
): Promise<void> {
  const row: Record<string, unknown> = { updated_at: Date.now() };
  if (patch.name !== undefined) row.name = patch.name;
  if (patch.email !== undefined) row.email = patch.email;
  if (patch.role !== undefined) row.role = patch.role;
  if (patch.teamCalendarScope !== undefined)
    row.team_calendar_scope = patch.teamCalendarScope;
  const { error } = await supabase.from("contacts").update(row).eq("id", contactId);
  if (error) throw error;
}

export async function deleteContact(
  supabase: SupabaseClient,
  contactId: string
): Promise<void> {
  const { error } = await supabase.from("contacts").delete().eq("id", contactId);
  if (error) throw error;
}

/* ── Activity ─────────────────────────────────────────────────────── */

export async function logActivity(
  supabase: SupabaseClient,
  userId: string,
  entry: Omit<ActivityEntry, "id" | "createdAt">
): Promise<void> {
  const row = clean({
    user_id: userId,
    case_id: entry.caseId ?? null,
    case_name: entry.caseName ?? null,
    action: entry.action,
    description: entry.description,
    user_email: entry.userEmail,
    created_at: Date.now(),
  });
  const { error } = await supabase.from("activity_log").insert(row);
  if (error) throw error;

  if (entry.caseId?.trim() && typeof window !== "undefined") {
    void notifySlackForActivity(supabase, entry);
  }
}

async function notifySlackForActivity(
  supabase: SupabaseClient,
  entry: Omit<ActivityEntry, "id" | "createdAt">
): Promise<void> {
  try {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) return;
    await fetch("/api/slack/activity", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        caseId: entry.caseId,
        caseName: entry.caseName,
        action: entry.action,
        description: entry.description,
        userEmail: entry.userEmail,
      }),
    });
  } catch (e) {
    console.warn("[logActivity] Slack notify failed", e);
  }
}

/** Firm-wide activity feed (`userId` unused). */
export async function fetchActivity(
  supabase: SupabaseClient,
  _userId: string,
  max: number
): Promise<ActivityEntry[]> {
  const { data, error } = await supabase
    .from("activity_log")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(max);
  if (error) throw error;
  return (data ?? []).map((r) => activityFromRow(r as Record<string, unknown>));
}

export function subscribeActivity(
  supabase: SupabaseClient,
  _userId: string,
  max: number,
  cb: (entries: ActivityEntry[]) => void
): Unsubscribe {
  const load = async () => {
    try {
      const list = await fetchActivity(supabase, _userId, max);
      cb(list);
    } catch (e) {
      console.warn("[subscribeActivity]", e);
      cb([]);
    }
  };
  void load();
  const lane =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `r${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const ch = supabase
    .channel(`activity:firm:${lane}`)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "activity_log" },
      () => {
        void load();
      }
    )
    .subscribe();
  return () => {
    void supabase.removeChannel(ch);
  };
}

/* ── Bulk ─────────────────────────────────────────────────────────── */

export async function bulkDeleteEvents(
  supabase: SupabaseClient,
  caseId: string,
  eventIds: string[]
): Promise<void> {
  if (!eventIds.length) return;
  const { error } = await supabase
    .from("case_events")
    .delete()
    .eq("case_id", caseId)
    .in("id", eventIds);
  if (error) throw error;
}

export async function bulkRescheduleEvents(
  supabase: SupabaseClient,
  caseId: string,
  eventIds: string[],
  shiftDays: number
): Promise<void> {
  if (!eventIds.length) return;
  const { data: rows, error: fetchErr } = await supabase
    .from("case_events")
    .select("id,date,deadline_end_date")
    .eq("case_id", caseId)
    .in("id", eventIds);
  if (fetchErr) throw fetchErr;
  const now = Date.now();
  for (const r of rows ?? []) {
    const oldDate = new Date(`${r.date as string}T00:00:00`);
    oldDate.setDate(oldDate.getDate() + shiftDays);
    const newDate = oldDate.toISOString().slice(0, 10);
    let newDeadline: string | null = null;
    const de = r.deadline_end_date as string | null | undefined;
    if (de && String(de).trim()) {
      const oldEnd = new Date(`${String(de).trim().slice(0, 10)}T00:00:00`);
      oldEnd.setDate(oldEnd.getDate() + shiftDays);
      newDeadline = oldEnd.toISOString().slice(0, 10);
    }
    if (newDeadline && newDeadline <= newDate) newDeadline = null;
    const { error } = await supabase
      .from("case_events")
      .update({ date: newDate, deadline_end_date: newDeadline, updated_at: now })
      .eq("id", r.id)
      .eq("case_id", caseId);
    if (error) throw error;
  }
}
