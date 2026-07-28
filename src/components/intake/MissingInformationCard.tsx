"use client";

import type { IntakeFlat } from "@/lib/intake-types";
import { getMissingIntakeFields, type MissingFieldItem } from "@/lib/intake-detail";
import { Badge, Button, Card, CardBody } from "@/components/ui";

type Props = {
  intake: IntakeFlat;
  editing: boolean;
  onEditField: (key: keyof IntakeFlat) => void;
};

const PRIORITY_LABEL: Record<MissingFieldItem["priority"], string> = {
  critical: "Critical",
  important: "Important",
  other: "Other",
};

export function MissingInformationCard({ intake, editing, onEditField }: Props) {
  const missing = getMissingIntakeFields(intake);
  const byPriority = {
    critical: missing.filter((m) => m.priority === "critical"),
    important: missing.filter((m) => m.priority === "important"),
    other: missing.filter((m) => m.priority === "other"),
  };

  return (
    <Card className="rounded-xl border-warning/30 shadow-none">
      <CardBody className="space-y-3 !px-4 !py-4">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-base font-semibold text-text">Missing Information</h2>
          <Badge variant={missing.length ? "warning" : "success"}>
            {missing.length ? `${missing.length} gaps` : "Complete"}
          </Badge>
        </div>

        {missing.length === 0 ? (
          <p className="text-sm text-text-muted">No critical qualification fields are empty.</p>
        ) : (
          (["critical", "important", "other"] as const).map((priority) => {
            const items = byPriority[priority];
            if (!items.length) return null;
            return (
              <div key={priority}>
                <h3 className="text-[11px] font-semibold uppercase tracking-wide text-text-muted">
                  {PRIORITY_LABEL[priority]}
                </h3>
                <ul className="mt-1.5 space-y-1.5">
                  {items.map((item) => (
                    <li
                      key={item.key}
                      className="flex items-center justify-between gap-2 rounded-md bg-warning-light/40 px-2.5 py-1.5"
                    >
                      <span className="text-sm text-text">{item.label}</span>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="!px-2 !py-1 text-xs"
                        onClick={() => onEditField(item.key)}
                      >
                        {editing ? "Jump" : "Add"}
                      </Button>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })
        )}
      </CardBody>
    </Card>
  );
}
