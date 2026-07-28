"use client";

import type { IntakeFlat } from "@/lib/intake-types";
import { getMissingIntakeFields } from "@/lib/intake-detail";
import { Badge, Button, Card, CardBody } from "@/components/ui";

type Props = {
  intake: IntakeFlat;
  editing: boolean;
  onEditField: (key: keyof IntakeFlat) => void;
};

export function MissingInformationCard({ intake, editing, onEditField }: Props) {
  const missing = getMissingIntakeFields(intake);

  return (
    <Card className="rounded-xl border-border shadow-none">
      <CardBody className="space-y-3 !px-4 !py-4">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-base font-semibold text-text">Missing Information</h2>
          {missing.length > 0 && (
            <Badge variant="default">{missing.length}</Badge>
          )}
        </div>

        {missing.length === 0 ? (
          <p className="text-sm text-text-muted">No empty fields in this list.</p>
        ) : (
          <ul className="space-y-1.5">
            {missing.map((item) => (
              <li
                key={item.key}
                className="flex items-center justify-between gap-2 rounded-md bg-surface-alt px-2.5 py-1.5"
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
        )}
      </CardBody>
    </Card>
  );
}
