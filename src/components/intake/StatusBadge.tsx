"use client";

import { Badge } from "@/components/ui";

export function StatusBadge({
  promoted,
}: {
  promoted: boolean;
}) {
  return promoted ? (
    <Badge variant="success">Promoted</Badge>
  ) : (
    <Badge variant="primary">Open</Badge>
  );
}
