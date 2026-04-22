import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { sendReminderEmail } from "@/lib/gmail";
import { differenceInCalendarDays, parseISO } from "date-fns";

export const runtime = "nodejs";
export const maxDuration = 300;

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function GET(req: Request): Promise<Response> {
  const authHeader = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createServiceRoleClient();
  if (!supabase) {
    return NextResponse.json(
      { error: "SUPABASE_SERVICE_ROLE_KEY not configured" },
      { status: 503 }
    );
  }

  try {
    const today = todayIso();
    let sent = 0;
    let skipped = 0;

    const { data: caseRows, error: casesErr } = await supabase
      .from("cases")
      .select("id, name, assigned_contact_ids")
      .eq("status", "active");
    if (casesErr) throw casesErr;

    for (const row of caseRows ?? []) {
      const caseId = row.id as string;
      const caseName = row.name as string;
      const assignedContactIds = (row.assigned_contact_ids as string[]) ?? [];

      const attendeeEmails: string[] = [];
      for (const contactId of assignedContactIds) {
        const { data: contact } = await supabase
          .from("contacts")
          .select("email")
          .eq("id", contactId)
          .maybeSingle();
        const email = contact?.email as string | undefined;
        if (email) attendeeEmails.push(email);
      }

      if (!attendeeEmails.length) continue;

      const { data: events, error: evErr } = await supabase
        .from("case_events")
        .select("*")
        .eq("case_id", caseId)
        .eq("included", true);
      if (evErr) throw evErr;

      for (const ev of events ?? []) {
        const eventDate = ev.date as string;
        const remindersMinutes = (ev.reminders_minutes as number[]) ?? [];
        const alreadySent = (ev.email_reminders_sent as number[]) ?? [];
        const category = (ev.category as string) ?? "other";

        const daysUntil = differenceInCalendarDays(parseISO(eventDate), parseISO(today));
        if (daysUntil < 0) continue;

        type Tier = { minutes: number; reminderDays: number };
        const dueTiers: Tier[] = [];
        for (const minutes of remindersMinutes) {
          if (alreadySent.includes(minutes)) continue;
          const reminderDays = Math.floor(minutes / 1440);
          if (reminderDays <= 0) continue;
          if (daysUntil > reminderDays) continue;
          dueTiers.push({ minutes, reminderDays });
        }
        if (dueTiers.length === 0) {
          skipped++;
          continue;
        }
        dueTiers.sort((a, b) => a.reminderDays - b.reminderDays);
        const { minutes: dueMinutes } = dueTiers[0]!;

        for (const email of attendeeEmails) {
          try {
            await sendReminderEmail({
              to: email,
              caseName,
              eventTitle: ev.title as string,
              eventDate,
              daysUntil,
              category,
            });
            sent++;
          } catch (err) {
            console.error("[cron] Failed to email", email, ":", err);
          }
        }

        await supabase
          .from("case_events")
          .update({ email_reminders_sent: [...alreadySent, dueMinutes] })
          .eq("id", ev.id as string)
          .eq("case_id", caseId);

        skipped++;
      }
    }

    console.log(`[cron] Done: ${sent} emails sent, ${skipped} events checked`);
    return NextResponse.json({ ok: true, sent, checked: skipped });
  } catch (e) {
    console.error("[cron] Error:", e);
    const msg = e instanceof Error ? e.message : "Cron failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
