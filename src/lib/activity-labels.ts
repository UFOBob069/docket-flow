import type { ActivityAction } from "@/lib/types";

export const ACTIVITY_ACTION_LABELS: Record<ActivityAction, string> = {
  case_created: "created case",
  case_archived: "archived case",
  case_activated: "reactivated case",
  case_deleted: "deleted case",
  event_created: "created events",
  event_edited: "edited event",
  event_deleted: "deleted event",
  events_bulk_deleted: "bulk deleted events",
  events_bulk_rescheduled: "bulk rescheduled events",
  contacts_reassigned: "reassigned contacts",
};
