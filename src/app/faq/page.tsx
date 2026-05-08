import { Card, CardBody, PageWrapper } from "@/components/ui";

const YOUTUBE_EMBED_SRC = "https://www.youtube.com/embed/IpuxiI6eyWk";

export default function FaqPage() {
  return (
    <PageWrapper className="pb-10">
      <div className="mx-auto w-full max-w-4xl px-6 pt-8">
        <h1 className="text-2xl font-semibold tracking-tight text-text sm:text-3xl">
          FAQ & How‑To Guide
        </h1>
        <p className="mt-2 text-sm text-text-muted">
          Docket Flow basics, recommended workflow, and troubleshooting.
        </p>

        <Card className="mt-6">
          <CardBody>
            <div className="overflow-hidden rounded-xl border border-border bg-black">
              <div className="relative aspect-video w-full">
                <iframe
                  className="absolute inset-0 h-full w-full"
                  src={YOUTUBE_EMBED_SRC}
                  title="Docket Flow walkthrough"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                  allowFullScreen
                  referrerPolicy="strict-origin-when-cross-origin"
                />
              </div>
            </div>
            <p className="mt-3 text-xs text-text-dim">
              If the video doesn’t load, open it on YouTube:{" "}
              <a
                className="font-medium text-primary hover:underline"
                href="https://www.youtube.com/watch?v=IpuxiI6eyWk"
                target="_blank"
                rel="noreferrer"
              >
                watch here
              </a>
              .
            </p>
          </CardBody>
        </Card>

        <div className="mt-8 space-y-6">
          <Card>
            <CardBody className="space-y-4">
              <h2 className="text-lg font-semibold text-text">Overview</h2>
              <p className="text-sm text-text-secondary">
                Docket Flow is the firm’s scheduling and deadline system. It reduces manual calendaring while syncing
                deadlines and meetings into Google Calendar.
              </p>
              <ul className="list-inside list-disc space-y-1 text-sm text-text-secondary">
                <li>Automatically calculates statute of limitations reminders</li>
                <li>Imports deadlines from legal documents using AI</li>
                <li>Syncs to Google Calendar</li>
                <li>Provides dashboards, filters, overdue tracking, and completion</li>
              </ul>
            </CardBody>
          </Card>

          <Card>
            <CardBody className="space-y-4">
              <h2 className="text-lg font-semibold text-text">Logging in</h2>
              <ul className="list-inside list-disc space-y-1 text-sm text-text-secondary">
                <li>Use your Ramos James email address to log in</li>
                <li>Only approved firm email accounts can access the system</li>
              </ul>
            </CardBody>
          </Card>

          <Card>
            <CardBody className="space-y-4">
              <h2 className="text-lg font-semibold text-text">Dashboard</h2>
              <ul className="list-inside list-disc space-y-1 text-sm text-text-secondary">
                <li>Overdue items</li>
                <li>Items due today</li>
                <li>Upcoming work (rolling 90‑day snapshot)</li>
                <li>Recent activity</li>
              </ul>
              <div>
                <p className="text-sm font-medium text-text">Filters</p>
                <ul className="mt-1 list-inside list-disc space-y-1 text-sm text-text-secondary">
                  <li>Date range</li>
                  <li>Attorney</li>
                  <li>Paralegal</li>
                  <li>Event type</li>
                </ul>
              </div>
              <div>
                <p className="text-sm font-medium text-text">Completing tasks</p>
                <ol className="mt-1 list-inside list-decimal space-y-1 text-sm text-text-secondary">
                  <li>Open the item</li>
                  <li>Mark it complete</li>
                  <li>It disappears from overdue lists</li>
                </ol>
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardBody className="space-y-4">
              <h2 className="text-lg font-semibold text-text">Creating a new case</h2>
              <ol className="list-inside list-decimal space-y-2 text-sm text-text-secondary">
                <li>
                  Dashboard → <span className="font-medium text-text">Add New Case</span>
                </li>
                <li>Enter case number, incident date, and assign attorney/paralegal</li>
                <li>
                  SOL is calculated automatically from the incident date (default 2 years).
                  <div className="mt-1 rounded-lg border border-warning/40 bg-warning-light/30 px-3 py-2 text-xs text-text-secondary">
                    Weekend handling: if the final SOL due date falls on Saturday or Sunday, it moves to the preceding
                    Friday.
                  </div>
                </li>
                <li>Create case → SOL milestones sync to the firm SOL calendar</li>
              </ol>
            </CardBody>
          </Card>

          <Card>
            <CardBody className="space-y-4">
              <h2 className="text-lg font-semibold text-text">Importing dates from documents</h2>
              <ol className="list-inside list-decimal space-y-2 text-sm text-text-secondary">
                <li>Open the case</li>
                <li>
                  Click <span className="font-medium text-text">Import Document with Dates</span> and upload the file
                </li>
                <li>Review extracted deadlines carefully for accuracy</li>
                <li>Remove anything you don’t want imported</li>
                <li>Confirm review and import → items sync to Google Calendar</li>
              </ol>
              <p className="text-sm text-text-secondary">
                Best practice: AI saves time, but the team is still responsible for validating dates, categories, and
                reminder schedules.
              </p>
            </CardBody>
          </Card>

          <Card>
            <CardBody className="space-y-4">
              <h2 className="text-lg font-semibold text-text">Deadlines vs meetings</h2>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="rounded-xl border border-border bg-surface-alt/50 px-4 py-3">
                  <p className="text-sm font-semibold text-text">⏰ Deadline</p>
                  <ul className="mt-2 list-inside list-disc space-y-1 text-sm text-text-secondary">
                    <li>All‑day by default (top of the calendar)</li>
                    <li>No time required</li>
                    <li>Used for due dates, filings, and obligations</li>
                  </ul>
                </div>
                <div className="rounded-xl border border-border bg-surface-alt/50 px-4 py-3">
                  <p className="text-sm font-semibold text-text">📅 Meeting / event</p>
                  <ul className="mt-2 list-inside list-disc space-y-1 text-sm text-text-secondary">
                    <li>Timed invite (start time required)</li>
                    <li>Sends calendar invite to attendees</li>
                    <li>Used for hearings, mediations, calls, meetings</li>
                  </ul>
                </div>
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardBody className="space-y-4">
              <h2 className="text-lg font-semibold text-text">Viewing cases</h2>
              <ul className="list-inside list-disc space-y-1 text-sm text-text-secondary">
                <li>Cases are sorted by case number</li>
                <li>The Cases tab shows event counts (and overdue counts)</li>
                <li>Open a case to view the timeline, edit items, and mark complete</li>
              </ul>
            </CardBody>
          </Card>

          <Card>
            <CardBody className="space-y-4">
              <h2 className="text-lg font-semibold text-text">Calendar view</h2>
              <ul className="list-inside list-disc space-y-1 text-sm text-text-secondary">
                <li>Shows upcoming events across all active cases</li>
                <li>Filter by attorney/paralegal/event type</li>
                <li>Switch between timeline and month views</li>
              </ul>
            </CardBody>
          </Card>

          <Card>
            <CardBody className="space-y-4">
              <h2 className="text-lg font-semibold text-text">Recommended workflow</h2>
              <ol className="list-inside list-decimal space-y-1 text-sm text-text-secondary">
                <li>Open Dashboard</li>
                <li>Handle overdue items</li>
                <li>Handle today’s items</li>
                <li>Mark completed items promptly</li>
                <li>Import new scheduling orders</li>
                <li>Create missing events manually</li>
              </ol>
            </CardBody>
          </Card>

          <Card>
            <CardBody className="space-y-4">
              <h2 className="text-lg font-semibold text-text">Troubleshooting</h2>
              <div className="space-y-3 text-sm text-text-secondary">
                <div>
                  <p className="font-medium text-text">Missing calendar event</p>
                  <ul className="mt-1 list-inside list-disc space-y-1">
                    <li>Confirm the event is synced</li>
                    <li>Check recipients/attendees (assignees, firm‑wide, one‑time emails)</li>
                    <li>Verify Google Calendar access</li>
                  </ul>
                </div>
                <div>
                  <p className="font-medium text-text">Incorrect AI extraction</p>
                  <ul className="mt-1 list-inside list-disc space-y-1">
                    <li>Edit the event manually</li>
                    <li>Remove incorrect items before import</li>
                    <li>Tell David if the issue repeats so categories/prompts can be improved</li>
                  </ul>
                </div>
                <div>
                  <p className="font-medium text-text">Login issues</p>
                  <p className="mt-1">
                    Only approved Ramos James email accounts can log in.
                  </p>
                </div>
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardBody className="space-y-2">
              <h2 className="text-lg font-semibold text-text">Support</h2>
              <p className="text-sm text-text-secondary">
                Questions, issues, or feature ideas: contact David on Slack. Feedback is encouraged.
              </p>
            </CardBody>
          </Card>
        </div>
      </div>
    </PageWrapper>
  );
}

