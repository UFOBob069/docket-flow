"use client";

import Link from "next/link";
import type { IntakeFlat } from "@/lib/intake-types";
import { getNeedsReviewItems, getPositiveIndicators } from "@/lib/intake-detail";
import { Badge, Card, CardBody } from "@/components/ui";

type Props = {
  intake: IntakeFlat;
  callId: string;
};

export function CaseReviewPanel({ intake, callId }: Props) {
  const promoted = Boolean(intake.case_id);
  const positives = getPositiveIndicators(intake);
  const concerns = getNeedsReviewItems(intake);

  return (
    <Card className="rounded-xl shadow-none">
      <CardBody className="space-y-4 !px-4 !py-4">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h2 className="text-base font-semibold text-text">Case Review</h2>
            <p className="mt-0.5 text-xs text-text-muted">
              Heuristic checklist from filled fields — not an automated score or legal opinion.
            </p>
          </div>
          {promoted ? <Badge variant="success">Promoted</Badge> : <Badge variant="primary">Open</Badge>}
        </div>

        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-success">Positive indicators</h3>
          {positives.length === 0 ? (
            <p className="mt-1 text-sm text-text-dim">None identified from current fields.</p>
          ) : (
            <ul className="mt-1.5 list-disc space-y-1 pl-4 text-sm text-text-secondary">
              {positives.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          )}
        </div>

        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-warning">Needs review</h3>
          {concerns.length === 0 ? (
            <p className="mt-1 text-sm text-text-dim">No major gaps flagged from current fields.</p>
          ) : (
            <ul className="mt-1.5 list-disc space-y-1 pl-4 text-sm text-text-secondary">
              {concerns.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          )}
        </div>

        {!promoted ? (
          <Link
            href={`/intakes/${encodeURIComponent(callId)}/promote`}
            className="inline-flex w-full items-center justify-center rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-primary-hover"
            onClick={(e) => {
              if (
                !window.confirm(
                  "Promote this intake to a new case? You can still review details on the next screen before creating it."
                )
              ) {
                e.preventDefault();
              }
            }}
          >
            Promote to Case
          </Link>
        ) : intake.case_id ? (
          <Link
            href={`/cases/${intake.case_id}`}
            className="inline-flex w-full items-center justify-center rounded-lg border border-border bg-white px-4 py-2.5 text-sm font-semibold text-text hover:bg-surface-alt"
          >
            Open case
          </Link>
        ) : null}
      </CardBody>
    </Card>
  );
}
