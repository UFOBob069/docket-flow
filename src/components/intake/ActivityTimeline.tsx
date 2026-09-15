"use client";

import type { IntakeFlat, IntakeInteraction } from "@/lib/intake-types";
import { formatIntakeWhen } from "@/lib/intake-detail";
import { Badge, Card, CardBody } from "@/components/ui";

type ActivityItem = {
  id: string;
  when: string;
  title: string;
  detail?: string;
  badge?: string;
};

function typeLabel(type: string | null | undefined): string {
  switch ((type ?? "").toLowerCase()) {
    case "call":
      return "Call";
    case "sona_call":
      return "Sona call";
    case "missed_call":
      return "Missed call";
    case "voicemail":
      return "Voicemail";
    case "text":
      return "Text";
    case "email":
      return "Email";
    default:
      return type?.trim() || "Interaction";
  }
}

function directionLabel(direction: string | null | undefined): string | null {
  const d = (direction ?? "").toLowerCase();
  if (d === "inbound") return "Inbound";
  if (d === "outbound") return "Outbound";
  return direction?.trim() || null;
}

function truncate(text: string, max = 280): string {
  const t = text.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, Math.max(0, max - 1))}…`;
}

function buildActivity(
  intake: IntakeFlat,
  interactions: IntakeInteraction[]
): ActivityItem[] {
  const items: ActivityItem[] = [];

  if (intake.created_at) {
    items.push({
      id: "created",
      when: intake.created_at,
      title: "Intake created",
      detail: intake.name?.trim() || undefined,
    });
  }

  if (intake.case_id) {
    items.push({
      id: "promoted",
      when: "",
      title: "Promoted to case",
      detail: `Case id ${intake.case_id}`,
      badge: "Promoted",
    });
  }

  for (const ix of interactions) {
    const label = typeLabel(ix.type);
    const dir = directionLabel(ix.direction);
    const content = ix.content?.trim() || "";
    items.push({
      id: ix.id,
      when: ix.occurred_at || "",
      title: dir ? `${dir} ${label.toLowerCase()}` : label,
      detail: content ? truncate(content) : undefined,
      badge: label,
    });
  }

  return items.sort((a, b) => {
    const ta = a.when ? new Date(a.when).getTime() : 0;
    const tb = b.when ? new Date(b.when).getTime() : 0;
    return tb - ta;
  });
}

export function ActivityTimeline({
  intake,
  interactions,
}: {
  intake: IntakeFlat;
  interactions: IntakeInteraction[];
}) {
  const items = buildActivity(intake, interactions);

  return (
    <Card className="rounded-xl shadow-none">
      <CardBody className="space-y-3 !px-5 !py-4">
        <h2 className="text-base font-semibold text-text">Activity</h2>
        {items.length === 0 ? (
          <p className="text-sm text-text-dim">No activity recorded yet.</p>
        ) : (
          <ol className="relative space-y-4 border-l border-border pl-4">
            {items.map((item) => (
              <li key={item.id} className="relative">
                <span
                  className="absolute -left-[1.3rem] top-1.5 h-2.5 w-2.5 rounded-full border-2 border-white bg-primary"
                  aria-hidden
                />
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-medium text-text">{item.title}</p>
                  {item.badge && <Badge variant="default">{item.badge}</Badge>}
                </div>
                {item.when && (
                  <p className="text-xs text-text-muted">{formatIntakeWhen(item.when)}</p>
                )}
                {item.detail && (
                  <p className="mt-1 whitespace-pre-wrap text-sm text-text-secondary">{item.detail}</p>
                )}
              </li>
            ))}
          </ol>
        )}
      </CardBody>
    </Card>
  );
}
