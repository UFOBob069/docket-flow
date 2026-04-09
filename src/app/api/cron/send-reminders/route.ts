import { NextResponse } from "next/server";
import { getFirestore } from "firebase-admin/firestore";
import { initAdmin } from "@/lib/firebase/admin";
import { sendReminderEmail } from "@/lib/gmail";
import { differenceInCalendarDays, parseISO } from "date-fns";

export const runtime = "nodejs";
export const maxDuration = 300;

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function GET(req: Request): Promise<Response> {
  // Verify cron secret (Vercel sets this header for cron jobs)
  const authHeader = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    initAdmin();
    const db = getFirestore();
    const today = todayIso();
    let sent = 0;
    let skipped = 0;

    // Get all active cases
    const casesSnap = await db.collection("cases").where("status", "==", "active").get();

    for (const caseDoc of casesSnap.docs) {
      const caseData = caseDoc.data();
      const caseName = caseData.name as string;
      const assignedContactIds = (caseData.assignedContactIds ?? []) as string[];

      // Get attendee emails from assigned contacts
      const attendeeEmails: string[] = [];
      for (const contactId of assignedContactIds) {
        const contactSnap = await db.collection("contacts").doc(contactId).get();
        if (contactSnap.exists) {
          const email = contactSnap.data()?.email;
          if (email) attendeeEmails.push(email);
        }
      }

      if (!attendeeEmails.length) continue;

      // Get events for this case
      const eventsSnap = await db
        .collection("cases")
        .doc(caseDoc.id)
        .collection("events")
        .where("included", "==", true)
        .get();

      for (const eventDoc of eventsSnap.docs) {
        const ev = eventDoc.data();
        const eventDate = ev.date as string;
        const remindersMinutes = (ev.remindersMinutes ?? []) as number[];
        const alreadySent = (ev.emailRemindersSent ?? []) as number[];
        const category = (ev.category ?? "other") as string;

        const daysUntil = differenceInCalendarDays(parseISO(eventDate), parseISO(today));
        if (daysUntil < 0) continue; // past events

        for (const minutes of remindersMinutes) {
          if (alreadySent.includes(minutes)) continue;

          const reminderDays = Math.floor(minutes / 1440);
          if (daysUntil > reminderDays) continue; // not yet time

          // This reminder is due today — send to all attendees
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

          // Mark this reminder as sent
          await eventDoc.ref.update({
            emailRemindersSent: [...alreadySent, minutes],
          });
          alreadySent.push(minutes);
        }

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
