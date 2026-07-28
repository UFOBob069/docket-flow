"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { IntakeFlat } from "@/lib/intake-types";
import { formatIntakeWhen } from "@/lib/intake-detail";
import { Badge, Button } from "@/components/ui";

type Props = {
  intake: IntakeFlat;
  callId: string;
};

export function IntakeHeader({ intake, callId }: Props) {
  const promoted = Boolean(intake.case_id);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  async function copyText(text: string, label: string) {
    try {
      await navigator.clipboard.writeText(text);
      setMenuOpen(false);
      window.alert(`${label} copied`);
    } catch {
      window.alert(`Could not copy ${label.toLowerCase()}`);
    }
  }

  return (
    <div className="sticky top-[57px] z-30 border-b border-border bg-white/95 shadow-sm backdrop-blur">
      <div className="mx-auto max-w-[1280px] px-4 py-3 sm:px-6 lg:px-8">
        <Link href="/intakes" className="text-xs font-medium text-text-muted hover:text-primary">
          ← Back to Intakes
        </Link>
        <div className="mt-2 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold tracking-tight text-text lg:text-[1.65rem]">
              {intake.name?.trim() || "Unnamed intake"}
            </h1>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-text-muted">
              {intake.phone?.trim() && (
                <a href={`tel:${intake.phone}`} className="font-medium text-text hover:text-primary">
                  {intake.phone}
                </a>
              )}
              <span>Intake {formatIntakeWhen(intake.created_at)}</span>
              {intake.accident_date?.trim() && <span>Accident {intake.accident_date}</span>}
              {promoted ? (
                <Badge variant="success">Promoted</Badge>
              ) : (
                <Badge variant="primary">Open</Badge>
              )}
              {intake.how_found?.trim() && <Badge variant="default">{intake.how_found}</Badge>}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {promoted && intake.case_id ? (
              <Link
                href={`/cases/${intake.case_id}`}
                className="inline-flex items-center justify-center rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-primary-hover"
              >
                View case
              </Link>
            ) : (
              <Link
                href={`/intakes/${encodeURIComponent(callId)}/promote`}
                className="inline-flex items-center justify-center rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-primary-hover"
                onClick={(e) => {
                  if (
                    !window.confirm(
                      "Promote this intake to a new case? You can still review details on the next screen before creating it."
                    )
                  ) {
                    e.preventDefault();
                  }
                }}
              >
                Promote to Case
              </Link>
            )}
            {intake.quo_link && (
              <a
                href={intake.quo_link}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center rounded-lg border border-border bg-white px-3 py-2 text-sm font-medium text-text-secondary hover:bg-surface-alt"
              >
                Open in Quo
              </a>
            )}
            <div className="relative" ref={menuRef}>
              <Button
                size="sm"
                variant="secondary"
                aria-expanded={menuOpen}
                aria-haspopup="menu"
                onClick={() => setMenuOpen((o) => !o)}
              >
                More
              </Button>
              {menuOpen && (
                <div
                  role="menu"
                  className="absolute right-0 z-40 mt-1 w-48 rounded-lg border border-border bg-white py-1 shadow-lg"
                >
                  {intake.phone?.trim() && (
                    <button
                      type="button"
                      role="menuitem"
                      className="block w-full px-3 py-2 text-left text-sm text-text hover:bg-surface-alt"
                      onClick={() => void copyText(intake.phone!.trim(), "Phone number")}
                    >
                      Copy phone number
                    </button>
                  )}
                  <button
                    type="button"
                    role="menuitem"
                    className="block w-full px-3 py-2 text-left text-sm text-text hover:bg-surface-alt"
                    onClick={() => void copyText(window.location.href, "Intake link")}
                  >
                    Copy intake link
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
