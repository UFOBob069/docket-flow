import type { SupabaseClient, RealtimeChannel } from "@supabase/supabase-js";
import type {
  ActivityAction,
  ActivityEntry,
  CalendarEvent,
  Case,
  Contact,
  EventCategory,
  EventKind,
} from "@/lib/types";

type Unsubscribe = () => void;

function clean<T extends Record<string, unknown>>(obj: T): T {
  return Object.fromEntries(
    Object.entries(obj).filter(([, v]) => v !== undefined)
  ) as T;
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
    notes: (r.notes as string) ?? null,
    caseType: (r.case_type as string) ?? null,
    status: r.status as Case["status"],
    documentUrl: (r.document_url as string) ?? undefined,
    documentFileName: (r.document_file_name as string) ?? undefined,
    assignedContactIds: ((r.assigned_contact_ids as string[]) ?? []).map(String),
    createdAt: Number(r.created_at),
    updatedAt: Number(r.updated_at),
  };
}

function eventFromRow(r: Record<string, unknown>): CalendarEvent {
  return {
    id: r.id as string,
    caseId: r.case_id as string,
    ownerId: r.user_id as string,
    title: r.title as string,
    date: r.date as string,
    description: (r.description as string) ?? "",
    category: r.category as EventCategory,
    eventKind: (r.event_kind as EventKind) ?? undefined,
    startDateTime: (r.start_date_time as string) ?? null,
    endDateTime: (r.end_date_time as string) ?? null,
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
    createdAt: Number(r.created_at),
    updatedAt: Number(r.updated_at),
  };
}

function contactFromRow(r: Record<string, unknown>): Contact {
  return {
    id: r.id as string,
    ownerId: r.user_id as string,
    name: r.name as string,
    email: r.email as string,
    role: r.role as Contact["role"],
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

function eventToRow(ev: CalendarEvent, ownerId: string): Record<string, unknown> {
  return clean({
    id: ev.id,
    case_id: ev.caseId,
    user_id: ownerId,
    title: ev.title,
    date: ev.date,
    description: ev.description,
    category: ev.category,
    event_kind: ev.eventKind ?? null,
    start_date_time: ev.startDateTime ?? null,
    end_date_time: ev.endDateTime ?? null,
    deponent_or_subject: ev.deponentOrSubject ?? null,
    external_attendees_text: ev.externalAttendeesText ?? null,
    extra_internal_contact_ids:
      ev.extraInternalContactIds?.length ? ev.extraInternalContactIds : null,
    zoom_link: ev.zoomLink ?? null,
    priority: ev.priority ?? null,
    calendar_origin: ev.calendarOrigin ?? "docketflow",
    google_event_id: ev.googleEventId ?? null,
    google_calendar_event_ids_by_email: ev.googleCalendarEventIdsByEmail ?? null,
    google_host_calendar_id: ev.googleHostCalendarId ?? null,
    included: ev.included,
    completed: ev.completed ?? false,
    group_suggested: ev.groupSuggested,
    group_id: ev.groupId ?? null,
    merge_with_same_group: ev.mergeWithSameGroup ?? false,
    noise_flag: ev.noiseFlag,
    noise_reason: ev.noiseReason ?? null,
    reminders_minutes: ev.remindersMinutes,
    email_reminders_sent: ev.emailRemindersSent ?? null,
    created_at: ev.createdAt,
    updated_at: ev.updatedAt,
  });
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

export async function fetchCasesForUser(
  supabase: SupabaseClient,
  userId: string
): Promise<Case[]> {
  const { data, error } = await supabase
    .from("cases")
    .select("*")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((r) => caseFromRow(r as Record<string, unknown>));
}

export function subscribeCases(
  supabase: SupabaseClient,
  userId: string,
  cb: (cases: Case[]) => void
): Unsubscribe {
  const load = async () => {
    try {
      const list = await fetchCasesForUser(supabase, userId);
      cb(list);
    } catch (e) {
      console.warn("[subscribeCases]", e);
      cb([]);
    }
  };
  void load();
  const ch = supabase
    .channel(`cases:user:${userId}`)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "cases", filter: `user_id=eq.${userId}` },
      () => {
        void load();
      }
    )
    .subscribe();
  return () => {
    void supabase.removeChannel(ch);
  };
}

export async function fetchCasesWithEvents(
  supabase: SupabaseClient,
  userId: string
): Promise<{ case: Case; events: CalendarEvent[] }[]> {
  const cases = await fetchCasesForUser(supabase, userId);
  const result: { case: Case; events: CalendarEvent[] }[] = [];
  for (const c of cases) {
    const events = await fetchEventsForCase(supabase, c.id);
    result.push({ case: c, events });
  }
  return result;
}

export async function fetchEventsForCase(
  supabase: SupabaseClient,
  caseId: string
): Promise<CalendarEvent[]> {
  const { data, error } = await supabase
    .from("case_events")
    .select("*")
    .eq("case_id", caseId)
    .order("date", { ascending: true });
  if (error) throw error;
  return (data ?? []).map((r) => eventFromRow(r as Record<string, unknown>));
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

/** Events whose calendar `date` falls in [startDate, endDate] (inclusive), with parent case row. */
export async function fetchEventsInDateRange(
  supabase: SupabaseClient,
  userId: string,
  startDate: string,
  endDate: string
): Promise<EventWithCaseRow[]> {
  const { data, error } = await supabase
    .from("case_events")
    .select("*, cases (id, name, client_name, assigned_contact_ids, status)")
    .eq("user_id", userId)
    .gte("date", startDate)
    .lte("date", endDate)
    .order("date", { ascending: true });
  if (error) throw error;
  return (data ?? []).flatMap((raw) => {
    const row = raw as Record<string, unknown>;
    const nested = row.cases as Record<string, unknown> | Record<string, unknown>[] | null | undefined;
    const cRow = Array.isArray(nested) ? nested[0] : nested;
    if (!cRow) return [];
    return [{ event: eventFromRow(row), case: caseCalendarMetaFromRow(cRow) }];
  });
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
  > & { assignedContactIds?: string[] }
): Promise<string> {
  const now = Date.now();
  const row = clean({
    user_id: ownerId,
    name: input.name.trim(),
    client_name: input.clientName.trim(),
    case_number: input.caseNumber?.trim() || null,
    cause_number: input.causeNumber?.trim() || null,
    court: input.court?.trim() || null,
    date_of_incident: input.dateOfIncident?.trim() || null,
    notes: input.notes?.trim() || null,
    case_type: input.caseType?.trim() || null,
    status: "active" as const,
    document_url: input.documentUrl ?? null,
    document_file_name: input.documentFileName ?? null,
    assigned_contact_ids: (input.assignedContactIds ?? []).filter(Boolean),
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
  if (patch.notes !== undefined) row.notes = patch.notes;
  if (patch.caseType !== undefined) row.case_type = patch.caseType;
  if (patch.status !== undefined) row.status = patch.status;
  if (patch.documentUrl !== undefined) row.document_url = patch.documentUrl;
  if (patch.documentFileName !== undefined) row.document_file_name = patch.documentFileName;
  if (patch.assignedContactIds !== undefined)
    row.assigned_contact_ids = patch.assignedContactIds.filter(Boolean);
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
  if (error) throw error;
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
  if (error) throw error;
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

export async function fetchContactsForUser(
  supabase: SupabaseClient,
  userId: string
): Promise<Contact[]> {
  const { data, error } = await supabase
    .from("contacts")
    .select("*")
    .eq("user_id", userId)
    .order("name");
  if (error) throw error;
  return (data ?? []).map((r) => contactFromRow(r as Record<string, unknown>));
}

export function subscribeContacts(
  supabase: SupabaseClient,
  userId: string,
  cb: (contacts: Contact[]) => void
): Unsubscribe {
  const load = async () => {
    try {
      const list = await fetchContactsForUser(supabase, userId);
      cb(list);
    } catch (e) {
      console.warn("[subscribeContacts]", e);
      cb([]);
    }
  };
  void load();
  const ch = supabase
    .channel(`contacts:user:${userId}`)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "contacts", filter: `user_id=eq.${userId}` },
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
}

export async function fetchActivity(
  supabase: SupabaseClient,
  userId: string,
  max: number
): Promise<ActivityEntry[]> {
  const { data, error } = await supabase
    .from("activity_log")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(max);
  if (error) throw error;
  return (data ?? []).map((r) => activityFromRow(r as Record<string, unknown>));
}

export function subscribeActivity(
  supabase: SupabaseClient,
  userId: string,
  max: number,
  cb: (entries: ActivityEntry[]) => void
): Unsubscribe {
  const load = async () => {
    try {
      const list = await fetchActivity(supabase, userId, max);
      cb(list);
    } catch (e) {
      console.warn("[subscribeActivity]", e);
      cb([]);
    }
  };
  void load();
  const ch = supabase
    .channel(`activity:user:${userId}`)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "activity_log", filter: `user_id=eq.${userId}` },
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
  const { data: rows, error: fetchErr } = await supabase
    .from("case_events")
    .select("id,date")
    .eq("case_id", caseId)
    .in("id", eventIds);
  if (fetchErr) throw fetchErr;
  const now = Date.now();
  for (const r of rows ?? []) {
    const oldDate = new Date(`${r.date as string}T00:00:00`);
    oldDate.setDate(oldDate.getDate() + shiftDays);
    const newDate = oldDate.toISOString().slice(0, 10);
    const { error } = await supabase
      .from("case_events")
      .update({ date: newDate, updated_at: now })
      .eq("id", r.id)
      .eq("case_id", caseId);
    if (error) throw error;
  }
}
