"use client";

import type { IntakeFlat } from "@/lib/intake-types";
import {
  buildIncidentSummary,
  formatIntakeValue,
  intakeInsuranceStatus,
  intakeLocationLine,
  intakePoliceStatus,
  intakeRepresentationStatus,
  intakeTreatmentStatus,
} from "@/lib/intake-detail";
import { Card, CardBody } from "@/components/ui";

function Fact({ label, value }: { label: string; value: string }) {
  const missing = value === "Not provided";
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-medium uppercase tracking-wide text-text-muted">{label}</dt>
      <dd className={`mt-0.5 text-sm ${missing ? "text-text-dim" : "text-text"}`}>{value}</dd>
    </div>
  );
}

export function CaseOverviewCard({ intake }: { intake: IntakeFlat }) {
  const summary = buildIncidentSummary(intake);
  const injuries = formatIntakeValue(intake.injury_types);
  const treatment = intakeTreatmentStatus(intake);
  const location = intakeLocationLine(intake) ?? "Not provided";

  return (
    <Card className="rounded-xl shadow-none">
      <CardBody className="space-y-4 !px-5 !py-4">
        <div>
          <h2 className="text-base font-semibold text-text">Case Overview</h2>
          <p className="mt-2 text-sm leading-relaxed text-text-secondary whitespace-pre-wrap">{summary}</p>
        </div>

        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-text-muted">Injuries</h3>
          <p className={`mt-1 text-sm ${injuries === "Not provided" ? "text-text-dim" : "text-text"}`}>
            {injuries}
          </p>
        </div>

        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-text-muted">Treatment</h3>
          <p className={`mt-1 text-sm ${treatment === "Not provided" ? "text-text-dim" : "text-text"}`}>
            {treatment}
          </p>
        </div>

        <dl className="grid gap-3 border-t border-border pt-4 sm:grid-cols-2 lg:grid-cols-3">
          <Fact label="Accident date" value={formatIntakeValue(intake.accident_date)} />
          <Fact label="Location" value={location} />
          <Fact label="Employer" value={formatIntakeValue(intake.employer)} />
          <Fact label="Insurance" value={intakeInsuranceStatus(intake)} />
          <Fact label="Representation" value={intakeRepresentationStatus(intake)} />
          <Fact label="Police / report" value={intakePoliceStatus(intake)} />
          <Fact label="Source / referral" value={formatIntakeValue(intake.how_found)} />
          <Fact
            label="Liability / how it happened"
            value={
              intake.accident_description?.trim()
                ? intake.accident_description.trim().length > 160
                  ? `${intake.accident_description.trim().slice(0, 157)}…`
                  : intake.accident_description.trim()
                : "Not provided"
            }
          />
        </dl>
      </CardBody>
    </Card>
  );
}
