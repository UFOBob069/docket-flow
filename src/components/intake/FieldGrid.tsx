"use client";

import type { IntakeFlat } from "@/lib/intake-types";
import {
  formatIntakeValue,
  type DetailSectionConfig,
} from "@/lib/intake-detail";
import { Input, Textarea } from "@/components/ui";

const BOOLEAN_KEYS = new Set<keyof IntakeFlat>([
  "ticket_issued",
  "drivable",
  "towed",
  "has_loan",
  "rental_needed",
  "missed_work",
  "pip",
  "med_pay",
  "um_uim",
  "ems",
  "hospital_bill",
  "medicaid",
  "medicare",
]);

type Props = {
  section: DetailSectionConfig;
  intake: IntakeFlat;
  draft: IntakeFlat;
  editing: boolean;
  highlightedKey?: keyof IntakeFlat | null;
  onChange: (key: keyof IntakeFlat, value: string | boolean | null) => void;
};

export function FieldGrid({
  section,
  intake,
  draft,
  editing,
  highlightedKey,
  onChange,
}: Props) {
  const model = editing ? draft : intake;

  return (
    <dl className="grid gap-x-4 gap-y-3 sm:grid-cols-2">
      {section.fields.map((field) => {
        const value = model[field.key];
        const display = formatIntakeValue(value);
        const missing = display === "Not provided";
        const highlight = highlightedKey === field.key;
        const isBool = BOOLEAN_KEYS.has(field.key);

        return (
          <div
            key={field.key}
            id={`field-${String(field.key)}`}
            className={`${field.multiline ? "sm:col-span-2" : ""} rounded-md px-1.5 py-1 ${
              highlight ? "ring-2 ring-primary/40 ring-offset-1" : ""
            } ${!editing && missing ? "bg-warning-light/50" : ""}`}
          >
            <dt className="text-[11px] font-medium uppercase tracking-wide text-text-muted">
              {field.label}
              {!editing && missing && (
                <span className="ml-1.5 font-normal normal-case text-warning">Missing</span>
              )}
            </dt>
            {editing ? (
              isBool ? (
                <select
                  className="mt-1 w-full rounded-lg border border-border bg-white px-3 py-2 text-sm text-text focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                  value={value === true ? "true" : value === false ? "false" : ""}
                  onChange={(e) => {
                    const v = e.target.value;
                    onChange(field.key, v === "" ? null : v === "true");
                  }}
                >
                  <option value="">Not set</option>
                  <option value="true">Yes</option>
                  <option value="false">No</option>
                </select>
              ) : field.multiline ? (
                <Textarea
                  className="mt-1"
                  rows={3}
                  value={String(value ?? "")}
                  onChange={(e) => onChange(field.key, e.target.value || null)}
                />
              ) : (
                <Input
                  className="mt-1"
                  value={String(value ?? "")}
                  onChange={(e) => onChange(field.key, e.target.value || null)}
                />
              )
            ) : (
              <dd
                className={`mt-0.5 text-sm whitespace-pre-wrap ${
                  missing ? "italic text-text-dim" : "text-text"
                }`}
              >
                {display}
              </dd>
            )}
          </div>
        );
      })}
    </dl>
  );
}
