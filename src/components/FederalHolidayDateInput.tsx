"use client";

import type { FederalHolidayIndex } from "@/lib/federal-holidays";
import {
  validateFederalHolidayDate,
  validateFederalHolidaySpan,
} from "@/lib/federal-holidays";
import { Input } from "@/components/ui";

type FederalHolidayDateInputProps = {
  value: string;
  onValueChange: (value: string) => void;
  holidays: FederalHolidayIndex | null;
  /** When set, also rejects ranges [spanStart, value] (deadline last day). */
  spanStart?: string;
  min?: string;
  className?: string;
  disabled?: boolean;
  onBlocked?: (message: string | null) => void;
};

export function FederalHolidayDateInput({
  value,
  onValueChange,
  holidays,
  spanStart,
  min,
  className,
  disabled,
  onBlocked,
}: FederalHolidayDateInputProps) {
  function handleChange(next: string) {
    if (!next) {
      onValueChange("");
      onBlocked?.(null);
      return;
    }
    let block: string | null = null;
    if (spanStart && next >= spanStart) {
      block = validateFederalHolidaySpan(spanStart, next, holidays);
    } else {
      block = validateFederalHolidayDate(next, holidays);
    }
    if (block) {
      onBlocked?.(block);
      return;
    }
    onBlocked?.(null);
    onValueChange(next);
  }

  return (
    <Input
      type="date"
      className={className}
      value={value}
      min={min}
      disabled={disabled}
      onChange={(e) => handleChange(e.target.value)}
    />
  );
}

export function FederalHolidayBlockedNotice({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p className="mt-1.5 rounded-lg border border-danger/25 bg-danger-light px-3 py-2 text-xs font-medium text-danger">
      {message}
    </p>
  );
}
