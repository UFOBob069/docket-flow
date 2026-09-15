"use client";

import { useMemo, useState } from "react";
import type { IntakeFlat, IntakeInteraction } from "@/lib/intake-types";
import { formatIntakeWhen, transcriptLineCount } from "@/lib/intake-detail";
import { Badge, Button, Card, CardBody, Input } from "@/components/ui";

type Props = {
  intake: IntakeFlat;
  interactions: IntakeInteraction[];
};

type ParsedLine = {
  raw: string;
  speaker: "specialist" | "caller" | "unknown";
  label: string;
  timestamp?: string;
  text: string;
};

const CALL_TYPES = new Set(["call", "sona_call"]);

function isCallInteraction(ix: IntakeInteraction): boolean {
  return CALL_TYPES.has((ix.type ?? "").trim().toLowerCase());
}

function parseTranscriptLines(transcript: string): ParsedLine[] {
  const lines = transcript.split(/\r?\n/);
  return lines.map((raw) => {
    const trimmed = raw.trim();
    if (!trimmed) {
      return { raw, speaker: "unknown" as const, label: "", text: "" };
    }

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
        isPhone || /caller|client|customer|prospect|lead|patient/.test(lower);
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

function typeLabel(type: string | null | undefined): string {
  switch ((type ?? "").toLowerCase()) {
    case "sona_call":
      return "Sona call";
    case "call":
      return "Call";
    default:
      return type?.trim() || "Call";
  }
}

function directionLabel(direction: string | null | undefined): string {
  const d = (direction ?? "").toLowerCase();
  if (d === "inbound") return "Inbound";
  if (d === "outbound") return "Outbound";
  return direction?.trim() || "";
}

type CallCardModel = {
  id: string;
  when: string | null;
  type: string | null;
  direction: string | null;
  content: string | null;
  transcript: string | null;
  quo_link: string | null;
  slack_permalink: string | null;
  legacy?: boolean;
};

function CallTranscriptExpander({ transcript }: { transcript: string }) {
  const [open, setOpen] = useState(false);
  const [expandedFull, setExpandedFull] = useState(false);
  const [query, setQuery] = useState("");
  const lines = useMemo(() => parseTranscriptLines(transcript), [transcript]);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return lines;
    return lines.filter((l) => l.raw.toLowerCase().includes(q));
  }, [lines, query]);
  const lineCount = transcriptLineCount(transcript);

  async function copyTranscript() {
    try {
      await navigator.clipboard.writeText(transcript);
      window.alert("Transcript copied");
    } catch {
      window.alert("Could not copy transcript");
    }
  }

  return (
    <div className="space-y-2 border-t border-border pt-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="secondary" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          {open ? "Hide transcript" : "View transcript"}
        </Button>
        <Badge variant="default">{lineCount} lines</Badge>
        {open && (
          <>
            <Button size="sm" variant="ghost" onClick={() => void copyTranscript()}>
              Copy
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setExpandedFull((v) => !v)}>
              {expandedFull ? "Limit height" : "Expand full"}
            </Button>
          </>
        )}
      </div>
      {open && (
        <div className="space-y-3">
          <Input
            placeholder="Search transcript…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search within transcript"
          />
          <div
            className={`space-y-2 overflow-y-auto rounded-lg border border-border bg-surface-alt/50 p-3 ${
              expandedFull ? "max-h-none" : "max-h-[420px]"
            }`}
            role="log"
            aria-label="Call transcript"
          >
            {filtered.map((line, i) => {
              if (!line.text && !line.label) return <div key={i} className="h-2" />;
              const bubble =
                line.speaker === "specialist"
                  ? "bg-primary/10 border-primary/20"
                  : line.speaker === "caller"
                    ? "bg-white border-border"
                    : "bg-transparent border-transparent";
              return (
                <div key={i} className={`rounded-lg border px-3 py-2 text-sm ${bubble}`}>
                  <div className="mb-0.5 flex flex-wrap items-baseline gap-2">
                    {line.label && <span className="text-xs font-semibold text-text">{line.label}</span>}
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
        </div>
      )}
    </div>
  );
}

function CallCard({ call }: { call: CallCardModel }) {
  const titleBits = [
    call.when ? formatIntakeWhen(call.when) : null,
    directionLabel(call.direction),
    typeLabel(call.type),
  ].filter(Boolean);

  return (
    <li className="rounded-xl border border-border bg-white px-4 py-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold text-text">{titleBits.join(" · ")}</h3>
            {call.legacy && <Badge variant="default">Legacy</Badge>}
          </div>
          {call.content?.trim() ? (
            <p className="mt-2 whitespace-pre-wrap text-sm text-text-secondary">{call.content.trim()}</p>
          ) : (
            <p className="mt-2 text-sm text-text-dim">No Quo summary for this call.</p>
          )}
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          {call.slack_permalink?.trim() && (
            <a
              href={call.slack_permalink}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center rounded-lg border border-border bg-white px-3 py-1.5 text-xs font-medium text-text-secondary hover:bg-surface-alt"
            >
              Slack
            </a>
          )}
          {call.quo_link?.trim() && (
            <a
              href={call.quo_link}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center rounded-lg border border-border bg-white px-3 py-1.5 text-xs font-medium text-text-secondary hover:bg-surface-alt"
            >
              Quo
            </a>
          )}
        </div>
      </div>
      {call.transcript?.trim() && <div className="mt-3"><CallTranscriptExpander transcript={call.transcript} /></div>}
    </li>
  );
}

export function CallsList({ intake, interactions }: Props) {
  const calls = useMemo(() => {
    const fromIx: CallCardModel[] = interactions.filter(isCallInteraction).map((ix) => ({
      id: ix.id,
      when: ix.occurred_at,
      type: ix.type,
      direction: ix.direction,
      content: ix.content,
      transcript: ix.transcript,
      quo_link: ix.quo_link,
      slack_permalink: ix.slack_permalink,
    }));

    if (fromIx.length > 0) return fromIx;

    // Older intakes before multi-call interactions: single qualifying-call fallback.
    if (intake.transcript?.trim() || intake.notes?.trim() || intake.quo_link?.trim()) {
      return [
        {
          id: "legacy-qualifying",
          when: intake.created_at,
          type: "call",
          direction: "inbound",
          content: intake.notes,
          transcript: intake.transcript,
          quo_link: intake.quo_link,
          slack_permalink: intake.slack_permalink,
          legacy: true,
        } satisfies CallCardModel,
      ];
    }
    return [];
  }, [intake, interactions]);

  if (calls.length === 0) return null;

  return (
    <Card className="rounded-xl shadow-none">
      <CardBody className="space-y-3 !px-5 !py-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-base font-semibold text-text">Calls</h2>
            <p className="mt-1 text-sm text-text-muted">
              Quo summaries for each call. Full transcripts stay collapsed.
            </p>
          </div>
          <Badge variant="default">
            {calls.length} call{calls.length !== 1 ? "s" : ""}
          </Badge>
        </div>
        <ul className="space-y-3">
          {calls.map((call) => (
            <CallCard key={call.id} call={call} />
          ))}
        </ul>
      </CardBody>
    </Card>
  );
}
