"use client";

import { Label } from "@/components/ui";
import {
  GOOGLE_CALENDAR_INVITE_COLOR_OPTIONS,
  normalizeGoogleCalendarInviteColorId,
  type GoogleCalendarInviteColorId,
} from "@/lib/google-calendar-invite-colors";

type Props = {
  value: string | null | undefined;
  onChange: (next: GoogleCalendarInviteColorId | null) => void;
  /** Hide when the row never syncs to Google (e.g. ICS mirror). */
  disabled?: boolean;
  hint?: string;
};

export function GoogleCalendarInviteColorPicker({ value, onChange, disabled, hint }: Props) {
  const current = normalizeGoogleCalendarInviteColorId(value ?? undefined);
  if (disabled) return null;

  return (
    <div>
      <Label>Google Calendar color</Label>
      <p className="mt-1 text-xs text-text-muted">
        {hint ??
          "Shown on Google Calendar invites (Peacock, Lavender, Sage, Flamingo, Tomato). Leave as default for the standard color."}
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button
          type="button"
          className={`rounded-full border-2 px-3 py-1.5 text-xs font-medium transition ${
            current === undefined
              ? "border-primary bg-primary-light/50 text-primary"
              : "border-border bg-white text-text-muted hover:bg-surface-alt"
          }`}
          onClick={() => onChange(null)}
        >
          Default
        </button>
        {GOOGLE_CALENDAR_INVITE_COLOR_OPTIONS.map((opt) => {
          const active = current === opt.id;
          return (
            <button
              key={opt.id}
              type="button"
              title={opt.label}
              aria-label={opt.label}
              aria-pressed={active}
              className={`flex items-center gap-2 rounded-full border-2 px-2.5 py-1.5 text-xs font-medium transition ${
                active ? "border-primary bg-primary-light/40 text-primary" : "border-border bg-white hover:bg-surface-alt"
              }`}
              onClick={() => onChange(opt.id)}
            >
              <span
                className="h-4 w-4 shrink-0 rounded-full border border-black/10 shadow-inner"
                style={{ backgroundColor: opt.swatch }}
                aria-hidden
              />
              <span className="text-text">{opt.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
