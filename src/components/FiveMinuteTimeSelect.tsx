"use client";

import { FIVE_MINUTE_TIMES, formatTimeOptionLabel } from "@/lib/five-minute-datetime";
import { Label, Select } from "@/components/ui";

type Props = {
  label: string;
  value: string;
  onChange: (timeHhmm: string) => void;
  allowNoTime?: boolean;
  noTimeLabel?: string;
  required?: boolean;
  hint?: string;
  disabled?: boolean;
};

export function FiveMinuteTimeSelect({
  label,
  value,
  onChange,
  allowNoTime,
  noTimeLabel = "No time",
  required,
  hint,
  disabled,
}: Props) {
  return (
    <div>
      <Label required={required}>{label}</Label>
      {hint && <p className="mt-1 text-xs text-text-dim">{hint}</p>}
      <Select
        className="mt-1.5 w-full min-w-[10.5rem] sm:max-w-xs"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      >
        {allowNoTime && <option value="">{noTimeLabel}</option>}
        {FIVE_MINUTE_TIMES.map((t) => (
          <option key={t} value={t}>
            {formatTimeOptionLabel(t)}
          </option>
        ))}
      </Select>
    </div>
  );
}
