"use client";

import { useEffect, useId, useRef, useState } from "react";
import { isoToDisplayDate, parseDisplayDate } from "@/lib/date-input-format";
import { Input } from "@/components/ui";

type DateInputProps = {
  /** ISO `YYYY-MM-DD` */
  value: string;
  onChange: (iso: string) => void;
  className?: string;
  required?: boolean;
  min?: string;
  disabled?: boolean;
};

export function DateInput({
  value,
  onChange,
  className = "",
  required,
  min,
  disabled,
}: DateInputProps) {
  const pickerId = useId();
  const pickerRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState(() => isoToDisplayDate(value));

  useEffect(() => {
    setText(isoToDisplayDate(value));
  }, [value]);

  function commitDisplay(raw: string, forceFormat = false) {
    setText(raw);
    const parsed = parseDisplayDate(raw);
    if (parsed !== null) {
      onChange(parsed);
      if (forceFormat && parsed) setText(isoToDisplayDate(parsed));
    }
  }

  return (
    <div className={`relative ${className}`}>
      <Input
        type="text"
        inputMode="numeric"
        autoComplete="bday"
        placeholder="mm/dd/yyyy"
        value={text}
        onChange={(e) => commitDisplay(e.target.value)}
        onBlur={(e) => commitDisplay(e.target.value, true)}
        required={required}
        disabled={disabled}
        className="pr-10"
        aria-describedby={`${pickerId}-hint`}
      />
      <input
        ref={pickerRef}
        id={pickerId}
        type="date"
        className="sr-only"
        value={value}
        min={min}
        tabIndex={-1}
        aria-hidden
        disabled={disabled}
        onChange={(e) => {
          onChange(e.target.value);
          setText(isoToDisplayDate(e.target.value));
        }}
      />
      <button
        type="button"
        className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-text-muted hover:bg-surface-alt hover:text-text"
        aria-label="Open calendar"
        disabled={disabled}
        onClick={() => {
          const el = pickerRef.current;
          if (!el) return;
          if (typeof el.showPicker === "function") {
            try {
              el.showPicker();
            } catch {
              el.focus();
            }
          } else {
            el.focus();
          }
        }}
      >
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5"
          />
        </svg>
      </button>
      <span id={`${pickerId}-hint`} className="sr-only">
        Type mm/dd/yyyy or use the calendar button
      </span>
    </div>
  );
}
