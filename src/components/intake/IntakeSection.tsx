"use client";

import { useId, useMemo, useState } from "react";
import type { IntakeFlat } from "@/lib/intake-types";
import { isIntakeFilled, type DetailSectionConfig } from "@/lib/intake-detail";
import { Badge, Button, Card, CardBody } from "@/components/ui";
import { FieldGrid } from "./FieldGrid";

type Props = {
  section: DetailSectionConfig;
  intake: IntakeFlat;
  draft: IntakeFlat;
  editing: boolean;
  busy: boolean;
  canEdit: boolean;
  defaultOpen?: boolean;
  highlightedKey?: keyof IntakeFlat | null;
  onChange: (key: keyof IntakeFlat, value: string | boolean | null) => void;
  onStartEdit: () => void;
  onSave: () => void;
  onCancel: () => void;
};

export function IntakeSection({
  section,
  intake,
  draft,
  editing,
  busy,
  canEdit,
  defaultOpen = true,
  highlightedKey,
  onChange,
  onStartEdit,
  onSave,
  onCancel,
}: Props) {
  const emptyCount = useMemo(
    () => section.fields.filter((f) => !isIntakeFilled(intake[f.key])).length,
    [intake, section.fields]
  );
  const [open, setOpen] = useState(defaultOpen || emptyCount > 0);
  const panelId = useId();
  const buttonId = useId();
  const effectivelyOpen = editing || open;

  const sectionDirty = useMemo(() => {
    return section.fields.some((f) => {
      const a = intake[f.key];
      const b = draft[f.key];
      return JSON.stringify(a ?? null) !== JSON.stringify(b ?? null);
    });
  }, [section.fields, intake, draft]);

  return (
    <Card className="rounded-xl shadow-none">
      <CardBody className="!px-0 !py-0">
        <div className="flex items-center gap-2 px-5 py-3">
          <button
            type="button"
            id={buttonId}
            aria-expanded={effectivelyOpen}
            aria-controls={panelId}
            className="flex min-w-0 flex-1 items-center gap-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            onClick={() => setOpen((v) => !v)}
          >
            <h2 className="text-base font-semibold text-text">{section.title}</h2>
            {emptyCount > 0 && (
              <Badge variant="warning">
                {emptyCount} empty
              </Badge>
            )}
            <span className="ml-auto text-xs font-medium text-text-muted" aria-hidden>
              {effectivelyOpen ? "Collapse" : "Expand"}
            </span>
          </button>

          {canEdit && !editing && (
            <Button
              size="sm"
              variant="secondary"
              className="shrink-0"
              onClick={(e) => {
                e.stopPropagation();
                setOpen(true);
                onStartEdit();
              }}
            >
              Edit fields
            </Button>
          )}
          {editing && (
            <div className="flex shrink-0 items-center gap-1.5">
              {sectionDirty && <Badge variant="warning">Unsaved</Badge>}
              <Button size="sm" disabled={busy || !sectionDirty} onClick={onSave}>
                {busy ? "Saving…" : "Save"}
              </Button>
              <Button size="sm" variant="ghost" disabled={busy} onClick={onCancel}>
                Cancel
              </Button>
            </div>
          )}
        </div>

        {effectivelyOpen && (
          <div
            id={panelId}
            role="region"
            aria-labelledby={buttonId}
            className="border-t border-border px-5 py-4"
          >
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
