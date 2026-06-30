import { NextResponse } from "next/server";
import { normalizeUsPhoneToE164 } from "@/lib/phone-format";
import { resolvedCaseClientName } from "@/lib/client-name";
import { createQuoContact } from "@/lib/quo-contact";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { getUserFromBearer } from "@/lib/supabase/auth-server";

export const runtime = "nodejs";

export async function POST(req: Request): Promise<Response> {
  const user = await getUserFromBearer(req.headers.get("authorization"));
  if (!user) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  let body: {
    caseId?: string;
    firstName?: string;
    lastName?: string;
    caseNumber?: string;
    phone?: string;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }

  const caseId = body.caseId?.trim();
  const firstName = body.firstName?.trim() ?? "";
  const lastName = body.lastName?.trim() ?? "";
  const caseNumber = body.caseNumber?.trim() ?? "";
  const phoneE164 = normalizeUsPhoneToE164(body.phone?.trim() ?? "");

  if (!caseId) {
    return NextResponse.json({ ok: false, error: "caseId is required" }, { status: 400 });
  }
  if (!firstName || !lastName) {
    return NextResponse.json({ ok: false, error: "firstName and lastName are required" }, { status: 400 });
  }
  if (!caseNumber) {
    return NextResponse.json({ ok: false, error: "caseNumber is required" }, { status: 400 });
  }
  if (!phoneE164) {
    return NextResponse.json({ ok: false, error: "A valid US phone number is required" }, { status: 400 });
  }

  try {
    const result = await createQuoContact({
      firstName,
      lastName,
      caseNumber,
      phoneE164,
    });

    if ("skipped" in result) {
      return NextResponse.json({ ok: true, synced: false, reason: result.reason });
    }

    const supabase = createServiceRoleClient();
    if (supabase) {
      const { error } = await supabase
        .from("cases")
        .update({
          client_name: resolvedCaseClientName({ clientFirstName: firstName, clientLastName: lastName }),
          client_first_name: firstName,
          client_last_name: lastName,
          client_phone: phoneE164,
          quo_contact_id: result.id,
          updated_at: Date.now(),
        })
        .eq("id", caseId);
      if (error) console.error("[quo/contact] case update", error);
    }

    return NextResponse.json({ ok: true, synced: true, quoContactId: result.id });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Quo contact create failed";
    console.error("[quo/contact]", message, e);
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}
