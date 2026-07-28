"use client";

import { useId, useState } from "react";
import type { IntakeFlat } from "@/lib/intake-types";
import { sectionHasAnyValue, type DetailSectionConfig } from "@/lib/intake-detail";
import { Card, CardBody } from "@/components/ui";
import { FieldGrid } from "./FieldGrid";

type Props = {
  section: DetailSectionConfig;
  intake: IntakeFlat;
  draft: IntakeFlat;
  editing: boolean;
  defaultOpen?: boolean;
  highlightedKey?: keyof IntakeFlat | null;
  onChange: (key: keyof IntakeFlat, value: string | boolean | null) => void;
};

export function IntakeSection({
  section,
  intake,
  draft,
  editing,
  defaultOpen = true,
  highlightedKey,
  onChange,
}: Props) {
  const hasValues = sectionHasAnyValue(intake, section);
  // Empty non-critical (and critical) sections stay hidden; gaps live in the sidebar.
  const show = editing || hasValues;
  const [open, setOpen] = useState(defaultOpen && (hasValues || editing));
  const panelId = useId();
  const buttonId = useId();

  if (!show) return null;

  const effectivelyOpen = editing || open;

  return (
    <Card className="rounded-xl shadow-none">
      <CardBody className="!px-0 !py-0">
        <h2 className="sr-only">{section.title}</h2>
        <button
          type="button"
          id={buttonId}
          aria-expanded={effectivelyOpen}
          aria-controls={panelId}
          className="flex w-full items-center justify-between gap-3 px-5 py-3.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
          onClick={() => setOpen((v) => !v)}
        >
          <span className="text-base font-semibold text-text">{section.title}</span>
          <span className="text-xs font-medium text-text-muted" aria-hidden>
            {effectivelyOpen ? "Collapse" : "Expand"}
          </span>
        </button>
        {effectivelyOpen && (
          <div id={panelId} role="region" aria-labelledby={buttonId} className="border-t border-border px-5 py-4">
            <FieldGrid
              section={section}
              intake={intake}
              draft={draft}
              editing={editing}
              highlightedKey={highlightedKey}
              onChange={onChange}
            />
          </div>
        )}
      </CardBody>
    </Card>
  );
}
