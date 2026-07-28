"use client";

import type { IntakeFlat, IntakeInteraction } from "@/lib/intake-types";
import { formatIntakeWhen } from "@/lib/intake-detail";
import { Badge, Button, Card, CardBody } from "@/components/ui";

type Props = {
  intake: IntakeFlat;
  interactions: IntakeInteraction[];
  onScrollToNotes: () => void;
};

export function NextStepsCard({ intake, interactions, onScrollToNotes }: Props) {
  const last = interactions.length ? interactions[interactions.length - 1] : null;
  const recommendation = (() => {
    if (!intake.phone?.trim()) return "Add a phone number before outreach.";
    if (!intake.accident_date?.trim()) return "Confirm accident date on the next contact.";
    if (!intake.injury_types?.trim()) return "Clarify injuries and treatment status.";
    if (!intake.client_insurance?.trim() && !intake.third_party_insurance?.trim()) {
      return "Ask about insurance coverage on follow-up.";
    }
    return "Review missing fields, then call or text via Quo.";
  })();

  return (
    <Card className="rounded-xl shadow-none">
      <CardBody className="space-y-3 !px-4 !py-4">
        <h2 className="text-base font-semibold text-text">Next Steps</h2>
        <p className="text-sm text-text-secondary">{recommendation}</p>

        <dl className="space-y-2 text-sm">
          <div>
            <dt className="text-[11px] font-medium uppercase tracking-wide text-text-muted">Last contact</dt>
            <dd className="mt-0.5 text-text">
              {last ? (
                <>
                  {formatIntakeWhen(last.created_at)}
                  {last.channel && (
                    <Badge className="ml-2" variant="default">
                      {last.channel}
                    </Badge>
                  )}
                  {last.summary && (
                    <span className="mt-1 block text-text-secondary">{last.summary}</span>
                  )}
                </>
              ) : (
                <span className="text-text-dim">No follow-up trail yet</span>
              )}
            </dd>
          </div>
          <div>
            <dt className="text-[11px] font-medium uppercase tracking-wide text-text-muted">Next follow-up</dt>
            <dd className="mt-0.5 text-text-dim">Not scheduled in DocketFlow</dd>
          </div>
        </dl>

        <div className="flex flex-wrap gap-2">
          {intake.phone?.trim() && (
            <a
              href={`tel:${intake.phone}`}
              className="inline-flex items-center justify-center rounded-lg border border-border bg-white px-3 py-1.5 text-sm font-medium text-text hover:bg-surface-alt"
            >
              Call
            </a>
          )}
          {intake.phone?.trim() && (
            <a
              href={`sms:${intake.phone}`}
              className="inline-flex items-center justify-center rounded-lg border border-border bg-white px-3 py-1.5 text-sm font-medium text-text hover:bg-surface-alt"
            >
              Text
            </a>
          )}
          {intake.quo_link && (
            <a
              href={intake.quo_link}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center rounded-lg border border-border bg-white px-3 py-1.5 text-sm font-medium text-text hover:bg-surface-alt"
            >
              Open in Quo
            </a>
          )}
        </div>

        <Button variant="secondary" size="sm" className="w-full" onClick={onScrollToNotes}>
          {intake.notes?.trim() ? "Add / edit follow-up note" : "Add follow-up note"}
        </Button>

        {interactions.length === 0 && (
          <p className="text-xs text-text-muted">
            Communication history is owned by the intake router. Notes you add here stay on this intake.
          </p>
        )}
      </CardBody>
    </Card>
  );
}
