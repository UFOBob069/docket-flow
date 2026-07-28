"use client";

import type { IntakeFlat } from "@/lib/intake-types";
import { Button, Card, CardBody, Textarea } from "@/components/ui";

type Props = {
  intake: IntakeFlat;
  draft: IntakeFlat;
  editing: boolean;
  busy: boolean;
  notesRef: React.RefObject<HTMLDivElement | null>;
  onStartEdit: () => void;
  onChangeNotes: (value: string | null) => void;
  onSave: () => void;
};

export function InternalNotes({
  intake,
  draft,
  editing,
  busy,
  notesRef,
  onStartEdit,
  onChangeNotes,
  onSave,
}: Props) {
  const notes = editing ? draft.notes : intake.notes;

  return (
    <Card className="rounded-xl shadow-none">
      <CardBody className="space-y-3 !px-5 !py-4">
        <div ref={notesRef} tabIndex={-1} className="outline-none">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-base font-semibold text-text">Internal Notes</h2>
            {!editing && (
              <Button size="sm" variant="secondary" onClick={onStartEdit}>
                {notes?.trim() ? "Edit note" : "Add note"}
              </Button>
            )}
          </div>

          {editing ? (
            <div className="mt-3 space-y-2">
              <Textarea
                rows={5}
                value={String(notes ?? "")}
                onChange={(e) => onChangeNotes(e.target.value || null)}
                placeholder="Internal follow-up notes…"
              />
              <Button size="sm" disabled={busy} onClick={onSave}>
                {busy ? "Saving…" : "Save note"}
              </Button>
            </div>
          ) : notes?.trim() ? (
            <p className="mt-2 whitespace-pre-wrap text-sm text-text-secondary">{notes}</p>
          ) : (
            <p className="mt-2 text-sm text-text-dim">No internal notes yet.</p>
          )}
        </div>
      </CardBody>
    </Card>
  );
}
