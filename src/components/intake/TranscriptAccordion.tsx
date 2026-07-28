"use client";

import { useMemo, useState } from "react";
import type { IntakeFlat } from "@/lib/intake-types";
import { formatIntakeWhen, transcriptLineCount } from "@/lib/intake-detail";
import { Badge, Button, Card, CardBody, Input } from "@/components/ui";

type Props = {
  intake: IntakeFlat;
};

type ParsedLine = {
  raw: string;
  speaker: "specialist" | "caller" | "unknown";
  label: string;
  timestamp?: string;
  text: string;
};

function parseTranscriptLines(transcript: string): ParsedLine[] {
  const lines = transcript.split(/\r?\n/);
  return lines.map((raw) => {
    const trimmed = raw.trim();
    if (!trimmed) {
      return { raw, speaker: "unknown" as const, label: "", text: "" };
    }

    // Common patterns: [12:34] Speaker: text | Speaker (12:34): text | +1555...: text
    const tsMatch = trimmed.match(/^\[?(\d{1,2}:\d{2}(?::\d{2})?)\]?\s*/);
    let rest = trimmed;
    let timestamp: string | undefined;
    if (tsMatch) {
      timestamp = tsMatch[1];
      rest = trimmed.slice(tsMatch[0].length);
    }

    const colon = rest.indexOf(":");
    if (colon > 0 && colon < 48) {
      const who = rest.slice(0, colon).trim();
      const text = rest.slice(colon + 1).trim();
      const lower = who.toLowerCase();
      const isPhone = /^\+?\d[\d\s\-().]{6,}$/.test(who);
      const specialist =
        /agent|specialist|intake|rep|staff|operator|assistant|bot/.test(lower) ||
        (!isPhone && /firm|office|docket/.test(lower));
      const caller =
        isPhone ||
        /caller|client|customer|prospect|lead|patient/.test(lower);
      return {
        raw,
        speaker: specialist ? "specialist" : caller ? "caller" : "unknown",
        label: isPhone ? (caller ? "Caller" : "Speaker") : who,
        timestamp,
        text: text || rest,
      };
    }

    return {
      raw,
      speaker: "unknown" as const,
      label: "",
      timestamp,
      text: rest,
    };
  });
}

export function TranscriptAccordion({ intake }: Props) {
  const transcript = intake.transcript?.trim() ?? "";
  const [open, setOpen] = useState(false);
  const [expandedFull, setExpandedFull] = useState(false);
  const [query, setQuery] = useState("");
  const lineCount = transcriptLineCount(transcript);

  const lines = useMemo(() => (transcript ? parseTranscriptLines(transcript) : []), [transcript]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return lines;
    return lines.filter((l) => l.raw.toLowerCase().includes(q));
  }, [lines, query]);

  if (!transcript) return null;

  async function copyTranscript() {
    try {
      await navigator.clipboard.writeText(transcript);
      window.alert("Transcript copied");
    } catch {
      window.alert("Could not copy transcript");
    }
  }

  return (
    <Card className="rounded-xl shadow-none">
      <CardBody className="space-y-3 !px-5 !py-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-base font-semibold text-text">Call Transcript</h2>
            <div className="mt-1.5 flex flex-wrap items-center gap-2 text-sm text-text-muted">
              <span>{formatIntakeWhen(intake.created_at)}</span>
              <Badge variant="default">{lineCount} lines</Badge>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="secondary"
              aria-expanded={open}
              onClick={() => setOpen((v) => !v)}
            >
              {open ? "Collapse" : "View transcript"}
            </Button>
            {open && (
              <>
                <Button size="sm" variant="ghost" onClick={() => void copyTranscript()}>
                  Copy
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setExpandedFull((v) => !v)}
                >
                  {expandedFull ? "Limit height" : "Expand full transcript"}
                </Button>
              </>
            )}
          </div>
        </div>

        {open && (
          <div className="space-y-3 border-t border-border pt-3">
            <Input
              placeholder="Search transcript…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Search within transcript"
            />
            <div
              className={`space-y-2 overflow-y-auto rounded-lg border border-border bg-surface-alt/50 p-3 ${
                expandedFull ? "max-h-none" : "max-h-[580px]"
              }`}
              role="log"
              aria-label="Call transcript"
            >
              {filtered.map((line, i) => {
                if (!line.text && !line.label) {
                  return <div key={i} className="h-2" />;
                }
                const bubble =
                  line.speaker === "specialist"
                    ? "bg-primary/10 border-primary/20"
                    : line.speaker === "caller"
                      ? "bg-white border-border"
                      : "bg-transparent border-transparent";
                return (
                  <div
                    key={i}
                    className={`rounded-lg border px-3 py-2 text-sm ${bubble}`}
                  >
                    <div className="mb-0.5 flex flex-wrap items-baseline gap-2">
                      {line.label && (
                        <span className="text-xs font-semibold text-text">{line.label}</span>
                      )}
                      {line.timestamp && (
                        <span className="text-[11px] text-text-muted">{line.timestamp}</span>
                      )}
                    </div>
                    <p className="whitespace-pre-wrap text-text-secondary">{line.text || line.raw}</p>
                  </div>
                );
              })}
              {filtered.length === 0 && (
                <p className="text-sm text-text-muted">No lines match your search.</p>
              )}
            </div>
            <p className="text-xs text-text-muted">
              Raw transcript text is preserved; speaker labels are for readability only.
            </p>
          </div>
        )}
      </CardBody>
    </Card>
  );
}
