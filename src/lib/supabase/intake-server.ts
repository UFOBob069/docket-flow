import type { SupabaseClient } from "@supabase/supabase-js";
import { buildIntakeRowUpdateFromPatch } from "@/lib/intake-update";
import type { IntakeFlat, IntakeInteraction, IntakeListItem } from "@/lib/intake-types";

function intakeFromFlatRow(r: Record<string, unknown>): IntakeFlat {
  return r as unknown as IntakeFlat;
}

export async function fetchIntakesList(
  supabase: SupabaseClient,
  opts: { q?: string; status?: "open" | "promoted" | "all"; limit?: number; offset?: number }
): Promise<IntakeListItem[]> {
  const limit = Math.min(opts.limit ?? 50, 100);
  const offset = opts.offset ?? 0;
  let q = supabase
    .from("intakes")
    .select("id, call_id, name, phone, accident_date, created_at, case_id, data")
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
    const r = row as Record<string, unknown>;
    const dataJson = (r.data as Record<string, unknown> | null) ?? {};
    const referral = (dataJson.referral as Record<string, unknown> | null) ?? {};
    return {
      id: r.id as string,
      call_id: (r.call_id as string) ?? null,
      name: (r.name as string) ?? null,
      phone: (r.phone as string) ?? null,
      accident_date: (r.accident_date as string) ?? null,
      created_at: (r.created_at as string) ?? null,
      case_id: (r.case_id as string) ?? null,
      how_found: (referral.how_found as string) ?? null,
      notes: (dataJson.notes as string) ?? null,
    };
  });
}

export async function fetchIntakeByCallId(
  supabase: SupabaseClient,
  callId: string
): Promise<IntakeFlat | null> {
  const { data, error } = await supabase
    .from("intakes_flat")
    .select("*")
    .eq("call_id", callId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;

  const { data: base, error: baseErr } = await supabase
    .from("intakes")
    .select("case_id")
    .eq("call_id", callId)
    .maybeSingle();
  if (baseErr) throw baseErr;

  return {
    ...intakeFromFlatRow(data as Record<string, unknown>),
    case_id: (base?.case_id as string) ?? null,
  };
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
    if (error.code === "42P01") return [];
    throw error;
  }
  return (data ?? []) as IntakeInteraction[];
}

export async function patchIntakeByCallId(
  supabase: SupabaseClient,
  callId: string,
  patch: Partial<IntakeFlat>
): Promise<IntakeFlat> {
  const { data: existing, error: loadErr } = await supabase
    .from("intakes")
    .select("id, data")
    .eq("call_id", callId)
    .maybeSingle();
  if (loadErr) throw loadErr;
  if (!existing) throw new Error("Intake not found");

  const { top, data } = buildIntakeRowUpdateFromPatch(
    patch,
    (existing.data as Record<string, unknown> | null) ?? null
  );

  const { error: updateErr } = await supabase
    .from("intakes")
    .update({ ...top, data })
    .eq("call_id", callId);
  if (updateErr) throw updateErr;

  const refreshed = await fetchIntakeByCallId(supabase, callId);
  if (!refreshed) throw new Error("Intake not found after update");
  return refreshed;
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
