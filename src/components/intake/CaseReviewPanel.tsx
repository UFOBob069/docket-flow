"use client";

import Link from "next/link";
import type { IntakeFlat } from "@/lib/intake-types";
import { getNeedsReviewItems } from "@/lib/intake-detail";
import { Badge, Card, CardBody } from "@/components/ui";

type Props = {
  intake: IntakeFlat;
  callId: string;
};

export function CaseReviewPanel({ intake, callId }: Props) {
  const promoted = Boolean(intake.case_id);
  const concerns = getNeedsReviewItems(intake);

  return (
    <Card className="rounded-xl shadow-none">
      <CardBody className="space-y-4 !px-4 !py-4">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h2 className="text-base font-semibold text-text">Needs review</h2>
            <p className="mt-0.5 text-xs text-text-muted">
              Gaps flagged from empty intake fields — not a case evaluation.
            </p>
          </div>
          {promoted ? <Badge variant="success">Promoted</Badge> : <Badge variant="primary">Open</Badge>}
        </div>

        {concerns.length === 0 ? (
          <p className="text-sm text-text-muted">No major qualification gaps from current fields.</p>
        ) : (
          <ul className="list-disc space-y-1.5 pl-4 text-sm text-text-secondary">
            {concerns.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        )}

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
