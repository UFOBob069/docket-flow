import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildIntakePlainColumnUpdate,
  intakeFromIntakesRow,
  INTAKE_EDITABLE_COLUMNS,
} from "@/lib/intake-update";
import type { IntakeFlat, IntakeInteraction, IntakeListItem } from "@/lib/intake-types";

const INTAKE_SELECT = [
  "id",
  "call_id",
  "created_at",
  "case_id",
  "data",
  ...INTAKE_EDITABLE_COLUMNS,
].join(",");

export async function fetchIntakesList(
  supabase: SupabaseClient,
  opts: { q?: string; status?: "open" | "promoted" | "all"; limit?: number; offset?: number }
): Promise<IntakeListItem[]> {
  const limit = Math.min(opts.limit ?? 50, 100);
  const offset = opts.offset ?? 0;
  let q = supabase
    .from("intakes")
    .select("id, call_id, name, phone, accident_date, created_at, case_id, how_found, notes, data")
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (opts.status === "open") q = q.is("case_id", null);
  else if (opts.status === "promoted") q = q.not("case_id", "is", null);

  const term = opts.q?.trim();
  if (term) {
    const like = `%${term.replace(/%/g, "\\%")}%`;
    q = q.or(`name.ilike.${like},phone.ilike.${like}`);
  }

  const { data, error } = await q;
  if (error) throw error;

  return (data ?? []).map((row) => {
    const flat = intakeFromIntakesRow(row as Record<string, unknown>);
    return {
      id: flat.id,
      call_id: flat.call_id,
      name: flat.name,
      phone: flat.phone,
      accident_date: flat.accident_date,
      created_at: flat.created_at,
      case_id: flat.case_id ?? null,
      how_found: flat.how_found,
      notes: flat.notes,
    };
  });
}

export async function fetchIntakeByCallId(
  supabase: SupabaseClient,
  callId: string
): Promise<IntakeFlat | null> {
  const { data, error } = await supabase
    .from("intakes")
    .select(INTAKE_SELECT)
    .eq("call_id", callId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return intakeFromIntakesRow(data as unknown as Record<string, unknown>);
}

function isMissingRelationError(error: {
  code?: string;
  message?: string;
  details?: string;
  hint?: string;
}): boolean {
  const code = error.code ?? "";
  if (code === "42P01" || code === "PGRST205" || code === "PGRST116") return true;
  const hay = `${error.message ?? ""} ${error.details ?? ""} ${error.hint ?? ""}`.toLowerCase();
  return (
    hay.includes("intake_interactions") &&
    (hay.includes("does not exist") ||
      hay.includes("could not find") ||
      hay.includes("schema cache") ||
      hay.includes("not find the table"))
  );
}

export async function fetchIntakeInteractions(
  supabase: SupabaseClient,
  callId: string
): Promise<IntakeInteraction[]> {
  const { data, error } = await supabase
    .from("intake_interactions")
    .select("id, intake_call_id, created_at, channel, direction, summary, body")
    .eq("intake_call_id", callId)
    .order("created_at", { ascending: true });
  if (error) {
    if (isMissingRelationError(error)) return [];
    console.warn("[intake_interactions]", error.code, error.message);
    return [];
  }
  return (data ?? []) as IntakeInteraction[];
}

export async function patchIntakeByCallId(
  supabase: SupabaseClient,
  callId: string,
  patch: Partial<IntakeFlat>
): Promise<IntakeFlat> {
  const row = buildIntakePlainColumnUpdate(patch);
  if (!Object.keys(row).length) {
    const existing = await fetchIntakeByCallId(supabase, callId);
    if (!existing) throw new Error("Intake not found");
    return existing;
  }

  const { data, error } = await supabase
    .from("intakes")
    .update(row)
    .eq("call_id", callId)
    .select(INTAKE_SELECT)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Intake not found");
  return intakeFromIntakesRow(data as unknown as Record<string, unknown>);
}

export async function linkIntakeToCase(
  supabase: SupabaseClient,
  callId: string,
  caseId: string
): Promise<void> {
  const { error } = await supabase.from("intakes").update({ case_id: caseId }).eq("call_id", callId);
  if (error) throw error;
}

/** Insert or merge tracker entry fields from intake on promote. */
export async function upsertCaseTrackerFromIntake(
  supabase: SupabaseClient,
  caseId: string,
  trackerPatch: Record<string, unknown>,
  userId?: string
): Promise<void> {
  const { data: existing, error: lookupErr } = await supabase
    .from("case_tracker_entries")
    .select("id")
    .eq("case_id", caseId)
    .maybeSingle();
  if (lookupErr) throw lookupErr;

  const row = {
    ...trackerPatch,
    updated_by: userId ?? null,
    updated_at: new Date().toISOString(),
  };

  if (existing) {
    const { error } = await supabase.from("case_tracker_entries").update(row).eq("case_id", caseId);
    if (error) throw error;
    return;
  }

  const { error } = await supabase.from("case_tracker_entries").insert({
    case_id: caseId,
    ...row,
    created_by: userId ?? null,
    created_at: new Date().toISOString(),
  });
  if (error) throw error;
}
