import { google } from "googleapis";

function getGmailAuth() {
  const clientEmail = process.env.GOOGLE_CLIENT_EMAIL;
  const privateKey = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n");
  const sender = process.env.GOOGLE_REMINDER_EMAIL;

  if (!clientEmail || !privateKey) {
    throw new Error("Set GOOGLE_CLIENT_EMAIL and GOOGLE_PRIVATE_KEY");
  }
  if (!sender) {
    throw new Error("Set GOOGLE_REMINDER_EMAIL (e.g. legalassistant@ramosjames.com)");
  }

  return {
    auth: new google.auth.JWT({
      email: clientEmail,
      key: privateKey,
      scopes: ["https://www.googleapis.com/auth/gmail.send"],
      subject: sender,
    }),
    sender,
  };
}

function buildMimeMessage(opts: {
  from: string;
  to: string;
  subject: string;
  html: string;
}): string {
  const lines = [
    `From: DocketFlow <${opts.from}>`,
    `To: ${opts.to}`,
    `Subject: ${opts.subject}`,
    "MIME-Version: 1.0",
    'Content-Type: text/html; charset="UTF-8"',
    "",
    opts.html,
  ];
  return Buffer.from(lines.join("\r\n"))
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export async function sendReminderEmail(opts: {
  to: string;
  caseName: string;
  eventTitle: string;
  eventDate: string;
  daysUntil: number;
  category: string;
}): Promise<void> {
  const { auth, sender } = getGmailAuth();
  const gmail = google.gmail({ version: "v1", auth });

  const urgencyColor = opts.daysUntil <= 7 ? "#DC2626" : opts.daysUntil <= 14 ? "#E8368F" : "#2563EB";
  const urgencyLabel = opts.daysUntil === 0 ? "TODAY" :
    opts.daysUntil === 1 ? "TOMORROW" :
    `in ${opts.daysUntil} days`;

  const subject = `⏰ Reminder: ${opts.eventTitle} — ${opts.caseName} (${urgencyLabel})`;

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 560px; margin: 0 auto;">
      <div style="border-left: 4px solid ${urgencyColor}; padding: 16px 20px; background: #f8fafc; border-radius: 0 8px 8px 0;">
        <p style="margin: 0 0 4px; font-size: 13px; color: #64748b; text-transform: uppercase; letter-spacing: 0.05em;">
          Upcoming Deadline — ${urgencyLabel}
        </p>
        <h2 style="margin: 0 0 8px; font-size: 18px; color: #0f172a;">${opts.eventTitle}</h2>
        <p style="margin: 0; font-size: 14px; color: #334155;">
          <strong>Case:</strong> ${opts.caseName}<br/>
          <strong>Date:</strong> ${opts.eventDate}<br/>
          <strong>Category:</strong> ${opts.category}
        </p>
      </div>
      <p style="margin: 16px 0 0; font-size: 12px; color: #94a3b8;">
        Sent by DocketFlow on behalf of Ramos James Law Group
      </p>
    </div>
  `;

  const raw = buildMimeMessage({ from: sender, to: opts.to, subject, html });

  await gmail.users.messages.send({
    userId: "me",
    requestBody: { raw },
  });

  console.log("[gmail] Sent reminder to", opts.to, "for", opts.eventTitle, "(", urgencyLabel, ")");
}
