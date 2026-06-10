"use client";

import { useEffect, useMemo, useState } from "react";
import { caseDisplayName } from "@/lib/case-display";
import { googleCalendarDescription, hasGoogleCalendarSync } from "@/lib/calendar-payload";
import { postCalendarSync } from "@/lib/calendar-client";
import {
  attendeeEmailsForEvent,
  contactNamesForIds,
  eventInviteContactIds,
  mergeOneTimeEmailsIntoExternalText,
  parseOneTimeEmailsFromExternalText,
} from "@/lib/event-attendees";
import { parseOneOffInviteEmails } from "@/lib/calendar-global-recipients";
import { getBrowserSupabase } from "@/lib/supabase/singleton";
import { logActivity, saveEvent } from "@/lib/supabase/repo";
import type { CalendarEvent, Case, Contact } from "@/lib/types";
import { Button, Card, CardBody, CardHeader, Label, Select, Textarea } from "@/components/ui";

type EventAttendeesModalProps = {
  open: boolean;
  onClose: () => void;
  caseRecord: Case;
  event: CalendarEvent;
  contacts: Contact[];
  idToken: string | null;
  user: { id: string; email?: string | null };
  onSaved: (message: string) => void;
  onError: (message: string) => void;
};

export function EventAttendeesModal({
  open,
  onClose,
  caseRecord,
  event,
  contacts,
  idToken,
  user,
  onSaved,
  onError,
}: EventAttendeesModalProps) {
  const [addContactRowIds, setAddContactRowIds] = useState<string[]>([]);
  const [addOneTimeEmails, setAddOneTimeEmails] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setAddContactRowIds([]);
    setAddOneTimeEmails("");
    setBusy(false);
  }, [open, event.id]);

  const existingInviteIds = useMemo(
    () => eventInviteContactIds(caseRecord, event),
    [caseRecord, event]
  );

  const existingOneTime = useMemo(
    () => parseOneTimeEmailsFromExternalText(event.externalAttendeesText),
    [event.externalAttendeesText]
  );

  const firmWideOnCase = useMemo(
    () =>
      contacts.filter(
        (ct) => ct.teamCalendarScope === "all_firm_events" && ct.email?.trim()
      ),
    [contacts]
  );

  const contactOptions = useMemo(() => {
    const onInvite = new Set(existingInviteIds);
    const pickedNew = new Set(addContactRowIds.filter(Boolean));
    return contacts
      .filter((ct) => Boolean(ct.email?.trim()))
      .filter((ct) => !onInvite.has(ct.id))
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((ct) => ({
        ...ct,
        disabled: pickedNew.has(ct.id) && !addContactRowIds.includes(ct.id),
      }));
  }, [contacts, existingInviteIds, addContactRowIds]);

  if (!open) return null;

  async function saveAttendees() {
    if (!idToken) {
      onError("Sign in again to update calendar invites.");
      return;
    }

    const newContactIds = addContactRowIds.filter(Boolean);
    const parsedOneTime = parseOneOffInviteEmails(addOneTimeEmails);
    if (!parsedOneTime.ok) {
      onError(parsedOneTime.error);
      return;
    }

    if (newContactIds.length === 0 && parsedOneTime.emails.length === 0) {
      onError("Add at least one contact or one-time email address.");
      return;
    }

    setBusy(true);
    try {
      const supabase = getBrowserSupabase();
      const mergedExtra = [
        ...new Set([...(event.extraInternalContactIds ?? []), ...newContactIds]),
      ];
      const mergedOneTime = Array.from(
        new Set([...existingOneTime, ...parsedOneTime.emails])
      );
      const updated: CalendarEvent = {
        ...event,
        extraInternalContactIds: mergedExtra.length ? mergedExtra : undefined,
        externalAttendeesText: mergeOneTimeEmailsIntoExternalText(
          event.externalAttendeesText,
          mergedOneTime
        ),
      };

      await saveEvent(supabase, caseRecord.id, updated);

      const solHost = Boolean(updated.googleHostCalendarId?.trim());
      const synced = hasGoogleCalendarSync(updated);

      if (synced && !solHost) {
        const attendeeEmails = attendeeEmailsForEvent(caseRecord, updated, contacts);
        if (attendeeEmails.length === 0) {
          onError("No email addresses found for the invite list.");
          return;
        }
        const res = await postCalendarSync(
          {
            action: "reconcile_team",
            caseName: caseDisplayName(caseRecord),
            attendeeEmails,
            events: [
              {
                title: updated.title,
                date: updated.date,
                description: googleCalendarDescription(updated),
                reminderMinutes: updated.remindersMinutes,
                location: updated.zoomLink?.trim() ?? "",
                scheduleKind: updated.scheduleKind,
                ...(updated.startDateTime ? { startDateTime: updated.startDateTime } : {}),
                ...(updated.endDateTime ? { endDateTime: updated.endDateTime } : {}),
                ...(!updated.startDateTime
                  ? { deadlineEndDate: updated.deadlineEndDate ?? null }
                  : {}),
                googleEventId: updated.googleEventId,
                googleCalendarEventIdsByEmail: updated.googleCalendarEventIdsByEmail,
                ...(updated.googleColorId !== undefined
                  ? { googleColorId: updated.googleColorId }
                  : {}),
              },
            ],
          },
          idToken
        );
        const data = (await res.json()) as {
          results?: { organizerEventId: string; idsByEmail: Record<string, string> }[];
          error?: string;
        };
        if (!res.ok) throw new Error(data.error ?? "Google Calendar update failed");
        const r = data.results?.[0];
        if (r?.organizerEventId) {
          await saveEvent(supabase, caseRecord.id, {
            ...updated,
            googleEventId: r.organizerEventId,
            googleCalendarEventIdsByEmail: r.idsByEmail,
          });
        }
      }

      const addedNames = contactNamesForIds(newContactIds, contacts);
      const parts: string[] = [];
      if (addedNames.length) parts.push(addedNames.join(", "));
      if (parsedOneTime.emails.length) parts.push(`${parsedOneTime.emails.length} email invite(s)`);

      await logActivity(supabase, user.id, {
        caseId: caseRecord.id,
        caseName: caseDisplayName(caseRecord),
        action: "event_edited",
        description: `Added people to "${updated.title}" (${updated.date}): ${parts.join("; ")}`,
        userEmail: user.email ?? "",
      });

      if (synced && solHost) {
        onSaved(
          `Saved invite list on "${updated.title}". SOL calendar events are firm-wide only — Google was not changed.`
        );
      } else if (synced) {
        onSaved(`Added people to "${updated.title}" and updated Google Calendar.`);
      } else {
        onSaved(
          `Saved people on "${updated.title}". They will be included when you create the Google invite.`
        );
      }
      onClose();
    } catch (e) {
      onError(e instanceof Error ? e.message : "Could not add people");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
      <Card className="max-h-[min(90vh,720px)] w-full max-w-lg overflow-y-auto shadow-2xl">
        <CardHeader>
          <h3 className="text-base font-semibold text-text">Add people</h3>
          <p className="mt-1 text-sm text-text-muted line-clamp-2">{event.title}</p>
        </CardHeader>
        <CardBody className="space-y-4">
          <div className="rounded-lg border border-border bg-surface-alt/50 px-4 py-3 text-sm">
            <p className="text-xs font-semibold uppercase tracking-wide text-text-dim">Already on invite</p>
            <ul className="mt-2 space-y-1 text-text">
              {existingInviteIds.length === 0 && (
                <li className="text-text-muted">No contacts with email on this event yet.</li>
              )}
              {existingInviteIds.map((id) => {
                const ct = contacts.find((c) => c.id === id);
                const onCase = (caseRecord.assignedContactIds ?? []).includes(id);
                const extra = (event.extraInternalContactIds ?? []).includes(id);
                return (
                  <li key={id}>
                    {ct ? (
                      <>
                        <span className="font-medium">{ct.name}</span>
                        {onCase && extra ? (
                          <span className="text-text-dim"> · case + event</span>
                        ) : onCase ? (
                          <span className="text-text-dim"> · case assignee</span>
                        ) : (
                          <span className="text-text-dim"> · added on event</span>
                        )}
                        {ct.email?.trim() && (
                          <span className="text-text-dim"> · {ct.email}</span>
                        )}
                      </>
                    ) : (
                      <span className="text-text-muted">Unknown contact</span>
                    )}
                  </li>
                );
              })}
            </ul>
            {firmWideOnCase.some((ct) => !existingInviteIds.includes(ct.id)) && (
              <p className="mt-2 text-xs text-text-muted">
                Firm-wide calendar contacts are merged automatically when Google sync runs.
              </p>
            )}
            {existingOneTime.length > 0 && (
              <p className="mt-2 text-xs text-text-muted">
                One-time emails: {existingOneTime.join(", ")}
              </p>
            )}
          </div>

          <div>
            <div className="flex items-center justify-between gap-2">
              <Label>Add contacts from firm list</Label>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setAddContactRowIds((prev) => [...prev, ""])}
              >
                + Add person
              </Button>
            </div>
            <div className="mt-2 space-y-2">
              {addContactRowIds.length === 0 && (
                <p className="text-xs text-text-dim">
                  Pick someone not already on the invite. Case assignees are included automatically.
                </p>
              )}
              {addContactRowIds.map((rowId, idx) => {
                const taken = new Set(
                  addContactRowIds.filter((id, i) => i !== idx && id).map((id) => id)
                );
                return (
                  <div key={idx} className="flex items-center gap-2">
                    <Select
                      className="min-w-0 flex-1"
                      value={rowId}
                      onChange={(e) => {
                        const v = e.target.value;
                        setAddContactRowIds((prev) => {
                          const next = [...prev];
                          next[idx] = v;
                          return next;
                        });
                      }}
                    >
                      <option value="">Select contact…</option>
                      {contactOptions
                        .filter((ct) => !taken.has(ct.id) || ct.id === rowId)
                        .map((ct) => (
                          <option key={ct.id} value={ct.id}>
                            {ct.name} ({ct.role.replace("_", " ")})
                          </option>
                        ))}
                    </Select>
                    <button
                      type="button"
                      className="shrink-0 text-danger hover:text-danger/80"
                      aria-label="Remove"
                      onClick={() =>
                        setAddContactRowIds((prev) => prev.filter((_, j) => j !== idx))
                      }
                    >
                      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                );
              })}
            </div>
          </div>

          <div>
            <Label>One-time email invites (optional)</Label>
            <Textarea
              rows={2}
              className="mt-1.5 font-mono text-sm"
              value={addOneTimeEmails}
              onChange={(e) => setAddOneTimeEmails(e.target.value)}
              placeholder="opposing@example.com, reporter@agency.com"
            />
            <p className="mt-1 text-xs text-text-muted">
              Comma or line separated. Gets a Google Calendar copy like team members (not saved as a contact).
            </p>
          </div>

          {hasGoogleCalendarSync(event) && event.googleHostCalendarId && (
            <p className="text-xs text-text-muted">
              This row uses the firm SOL calendar — new people are saved in DocketFlow only.
            </p>
          )}

          <div className="flex justify-end gap-3 pt-2">
            <Button variant="ghost" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button disabled={busy || !idToken} onClick={() => void saveAttendees()}>
              {busy ? "Saving…" : "Save & update calendar"}
            </Button>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
