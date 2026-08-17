import type { jsPDF } from "jspdf";
import type { IntakeFlat } from "@/lib/intake-types";
import {
  INTAKE_DETAIL_SECTIONS,
  buildIncidentSummary,
  formatIntakeValue,
  formatIntakeWhen,
  getMissingIntakeFields,
  intakeInsuranceStatus,
  intakeLocationLine,
  intakePoliceStatus,
  intakeRepresentationStatus,
  intakeTreatmentStatus,
} from "@/lib/intake-detail";

const MARGIN = 54;
const FOOTER_ZONE = 56;
const LINE = 13;
const SECTION_GAP = 14;
const INK: [number, number, number] = [28, 32, 40];
const MUTED: [number, number, number] = [88, 94, 104];
const RULE: [number, number, number] = [40, 44, 52];
const RULE_LIGHT: [number, number, number] = [190, 196, 204];
const LINK: [number, number, number] = [20, 70, 140];

function safeFilenamePart(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

function pageInnerBottom(doc: jsPDF): number {
  return doc.internal.pageSize.getHeight() - FOOTER_ZONE;
}

function ensureSpace(doc: jsPDF, y: number, needed: number): number {
  if (y + needed <= pageInnerBottom(doc)) return y;
  doc.addPage();
  return MARGIN + 8;
}

function drawWrapped(
  doc: jsPDF,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight = LINE
): number {
  const lines = doc.splitTextToSize(text || "—", maxWidth) as string[];
  for (const line of lines) {
    y = ensureSpace(doc, y, lineHeight);
    doc.text(line, x, y);
    y += lineHeight;
  }
  return y;
}

function drawDoubleRule(doc: jsPDF, y: number, pageWidth: number): number {
  doc.setDrawColor(...RULE);
  doc.setLineWidth(1.1);
  doc.line(MARGIN, y, pageWidth - MARGIN, y);
  doc.setLineWidth(0.4);
  doc.line(MARGIN, y + 3, pageWidth - MARGIN, y + 3);
  return y + 12;
}

function drawSectionTitle(doc: jsPDF, title: string, y: number, pageWidth: number): number {
  y = ensureSpace(doc, y, 28);
  doc.setFont("times", "bold");
  doc.setFontSize(11);
  doc.setTextColor(...INK);
  doc.text(title.toUpperCase(), MARGIN, y);
  y += 5;
  doc.setDrawColor(...RULE);
  doc.setLineWidth(0.8);
  doc.line(MARGIN, y, pageWidth - MARGIN, y);
  return y + 14;
}

/** Label and value on one line when short; wraps value under the label column when long. */
function drawFieldRow(
  doc: jsPDF,
  label: string,
  value: string,
  y: number,
  pageWidth: number
): number {
  const labelWidth = 132;
  const valueX = MARGIN + labelWidth;
  const valueWidth = pageWidth - valueX - MARGIN;
  const display = value?.trim() ? value : "—";
  const valueLines = doc.splitTextToSize(display, valueWidth) as string[];
  const blockH = Math.max(LINE, valueLines.length * LINE) + 5;
  y = ensureSpace(doc, y, blockH);

  doc.setFont("times", "bold");
  doc.setFontSize(9.5);
  doc.setTextColor(...MUTED);
  doc.text(`${label}:`, MARGIN, y);

  doc.setFont("times", "normal");
  doc.setFontSize(10);
  doc.setTextColor(...INK);
  let vy = y;
  for (const line of valueLines) {
    doc.text(line, valueX, vy);
    vy += LINE;
  }

  doc.setDrawColor(...RULE_LIGHT);
  doc.setLineWidth(0.3);
  doc.line(MARGIN, vy - 2, pageWidth - MARGIN, vy - 2);
  return vy + 6;
}

function drawTwoColumnFields(
  doc: jsPDF,
  leftLabel: string,
  leftValue: string,
  rightLabel: string,
  rightValue: string,
  y: number,
  pageWidth: number
): number {
  const gap = 18;
  const colWidth = (pageWidth - MARGIN * 2 - gap) / 2;
  const leftX = MARGIN;
  const rightX = MARGIN + colWidth + gap;
  const labelW = 70;
  const leftValW = colWidth - labelW;
  const rightValW = colWidth - labelW;

  const leftLines = doc.splitTextToSize(leftValue?.trim() || "—", leftValW) as string[];
  const rightLines = doc.splitTextToSize(rightValue?.trim() || "—", rightValW) as string[];
  const rows = Math.max(leftLines.length, rightLines.length);
  y = ensureSpace(doc, y, rows * LINE + 8);

  doc.setFont("times", "bold");
  doc.setFontSize(9);
  doc.setTextColor(...MUTED);
  doc.text(`${leftLabel}:`, leftX, y);
  doc.text(`${rightLabel}:`, rightX, y);

  doc.setFont("times", "normal");
  doc.setFontSize(10);
  doc.setTextColor(...INK);
  for (let i = 0; i < rows; i += 1) {
    const yy = y + i * LINE;
    if (leftLines[i]) doc.text(leftLines[i], leftX + labelW, yy);
    if (rightLines[i]) doc.text(rightLines[i], rightX + labelW, yy);
  }

  const bottom = y + rows * LINE + 2;
  doc.setDrawColor(...RULE_LIGHT);
  doc.setLineWidth(0.3);
  doc.line(MARGIN, bottom, pageWidth - MARGIN, bottom);
  return bottom + 6;
}

function drawParagraph(
  doc: jsPDF,
  label: string,
  text: string,
  y: number,
  pageWidth: number
): number {
  const maxWidth = pageWidth - MARGIN * 2;
  y = ensureSpace(doc, y, LINE * 2);
  doc.setFont("times", "bold");
  doc.setFontSize(9.5);
  doc.setTextColor(...MUTED);
  doc.text(`${label}:`, MARGIN, y);
  y += LINE;
  doc.setFont("times", "normal");
  doc.setFontSize(10);
  doc.setTextColor(...INK);
  y = drawWrapped(doc, text, MARGIN, y, maxWidth, LINE);
  doc.setDrawColor(...RULE_LIGHT);
  doc.setLineWidth(0.3);
  doc.line(MARGIN, y, pageWidth - MARGIN, y);
  return y + 8;
}

function drawLinkedUrl(doc: jsPDF, url: string, y: number, pageWidth: number): number {
  doc.setFont("times", "normal");
  doc.setFontSize(9);
  doc.setTextColor(...LINK);
  const lines = doc.splitTextToSize(url, pageWidth - MARGIN * 2) as string[];
  for (const line of lines) {
    y = ensureSpace(doc, y, 12);
    doc.textWithLink(line, MARGIN, y, { url });
    y += 12;
  }
  doc.setTextColor(...INK);
  return y;
}

export async function downloadIntakePdf(intake: IntakeFlat, pageUrl: string): Promise<void> {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  const pageWidth = doc.internal.pageSize.getWidth();
  let y = MARGIN - 6;

  const name = intake.name?.trim() || "Unnamed intake";
  const generatedAt = new Date().toLocaleString(undefined, {
    month: "long",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  const refId = (intake.call_id || intake.id).trim();

  // Letterhead
  doc.setFont("times", "bold");
  doc.setFontSize(9);
  doc.setTextColor(...MUTED);
  doc.text("DOCKETFLOW", MARGIN, y);
  doc.text("CONFIDENTIAL", pageWidth - MARGIN, y, { align: "right" });
  y += 16;

  doc.setFont("times", "bold");
  doc.setFontSize(16);
  doc.setTextColor(...INK);
  doc.text("CLIENT INTAKE REPORT", MARGIN, y);
  y += 8;
  y = drawDoubleRule(doc, y, pageWidth);

  doc.setFont("times", "bold");
  doc.setFontSize(13);
  doc.text(name, MARGIN, y);
  y += 16;

  y = drawTwoColumnFields(
    doc,
    "Phone",
    formatIntakeValue(intake.phone),
    "Status",
    intake.case_id ? "Promoted to case" : "Open intake",
    y,
    pageWidth
  );
  y = drawTwoColumnFields(
    doc,
    "Intake date",
    formatIntakeWhen(intake.created_at),
    "Accident date",
    formatIntakeValue(intake.accident_date),
    y,
    pageWidth
  );
  y = drawTwoColumnFields(
    doc,
    "Referral source",
    formatIntakeValue(intake.how_found),
    "Document generated",
    generatedAt,
    y,
    pageWidth
  );
  y = drawFieldRow(doc, "Intake reference", refId, y, pageWidth);

  doc.setFont("times", "bold");
  doc.setFontSize(9.5);
  doc.setTextColor(...MUTED);
  y = ensureSpace(doc, y, 24);
  doc.text("Electronic record:", MARGIN, y);
  y += LINE;
  y = drawLinkedUrl(doc, pageUrl, y, pageWidth);
  y += SECTION_GAP;

  // Overview
  y = drawSectionTitle(doc, "I. Case Overview", y, pageWidth);
  y = drawParagraph(doc, "Incident summary", buildIncidentSummary(intake), y, pageWidth);
  y = drawTwoColumnFields(
    doc,
    "Injuries",
    formatIntakeValue(intake.injury_types),
    "Treatment",
    intakeTreatmentStatus(intake),
    y,
    pageWidth
  );
  y = drawTwoColumnFields(
    doc,
    "Location",
    intakeLocationLine(intake) ?? "Not provided",
    "Employer",
    formatIntakeValue(intake.employer),
    y,
    pageWidth
  );
  y = drawTwoColumnFields(
    doc,
    "Insurance",
    intakeInsuranceStatus(intake),
    "Representation",
    intakeRepresentationStatus(intake),
    y,
    pageWidth
  );
  y = drawFieldRow(doc, "Police / report", intakePoliceStatus(intake), y, pageWidth);
  y += SECTION_GAP;

  // Detail sections (roman-ish numbering continuing from I)
  const sectionNumbers = ["II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI"];
  INTAKE_DETAIL_SECTIONS.forEach((section, index) => {
    const numeral = sectionNumbers[index] ?? `${index + 2}`;
    y = drawSectionTitle(doc, `${numeral}. ${section.title}`, y, pageWidth);
    for (let i = 0; i < section.fields.length; i += 2) {
      const left = section.fields[i];
      const right = section.fields[i + 1];
      if (left.multiline || !right) {
        if (left.multiline) {
          y = drawParagraph(doc, left.label, formatIntakeValue(intake[left.key]), y, pageWidth);
        } else {
          y = drawFieldRow(doc, left.label, formatIntakeValue(intake[left.key]), y, pageWidth);
        }
        if (right) {
          if (right.multiline) {
            y = drawParagraph(doc, right.label, formatIntakeValue(intake[right.key]), y, pageWidth);
          } else {
            y = drawFieldRow(doc, right.label, formatIntakeValue(intake[right.key]), y, pageWidth);
          }
        }
      } else {
        y = drawTwoColumnFields(
          doc,
          left.label,
          formatIntakeValue(intake[left.key]),
          right.label,
          formatIntakeValue(intake[right.key]),
          y,
          pageWidth
        );
      }
    }
    y += SECTION_GAP;
  });

  if (intake.notes?.trim()) {
    y = drawSectionTitle(doc, "Internal Notes", y, pageWidth);
    y = drawParagraph(doc, "Notes", intake.notes.trim(), y, pageWidth);
    y += SECTION_GAP;
  }

  // Source / attestation before missing items
  y = drawSectionTitle(doc, "Document Reference", y, pageWidth);
  doc.setFont("times", "normal");
  doc.setFontSize(10);
  doc.setTextColor(...INK);
  y = drawWrapped(
    doc,
    "This report was generated from the DocketFlow intake record. The authoritative electronic record is available at the link below.",
    MARGIN,
    y,
    pageWidth - MARGIN * 2
  );
  y += 6;
  y = drawLinkedUrl(doc, pageUrl, y, pageWidth);
  y += SECTION_GAP;

  // Missing information last
  const missing = getMissingIntakeFields(intake);
  y = drawSectionTitle(
    doc,
    missing.length > 0
      ? `Outstanding Information (${missing.length} item${missing.length === 1 ? "" : "s"})`
      : "Outstanding Information",
    y,
    pageWidth
  );
  doc.setFont("times", "normal");
  doc.setFontSize(10);
  doc.setTextColor(...INK);
  if (missing.length === 0) {
    y = drawWrapped(
      doc,
      "No qualification-critical fields were flagged as missing at the time this document was generated.",
      MARGIN,
      y,
      pageWidth - MARGIN * 2
    );
  } else {
    y = drawWrapped(
      doc,
      "The following items were incomplete in DocketFlow when this report was created and may require follow-up:",
      MARGIN,
      y,
      pageWidth - MARGIN * 2
    );
    y += 6;
    for (const item of missing) {
      y = ensureSpace(doc, y, LINE);
      doc.text(`•  ${item.label}`, MARGIN + 6, y);
      y += LINE;
    }
  }

  // Footers on all pages
  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i += 1) {
    doc.setPage(i);
    const pageHeight = doc.internal.pageSize.getHeight();
    const footerY = pageHeight - 32;
    doc.setDrawColor(...RULE);
    doc.setLineWidth(0.6);
    doc.line(MARGIN, footerY - 10, pageWidth - MARGIN, footerY - 10);
    doc.setFont("times", "italic");
    doc.setFontSize(8);
    doc.setTextColor(...MUTED);
    doc.text(
      "Confidential — for internal firm use. Do not distribute outside authorized personnel.",
      MARGIN,
      footerY
    );
    doc.setFont("times", "normal");
    doc.text(`Page ${i} of ${pageCount}`, pageWidth - MARGIN, footerY, { align: "right" });
  }

  const base = safeFilenamePart(name) || "intake";
  const idPart = safeFilenamePart(refId).slice(0, 18);
  doc.save(`intake-${base}${idPart ? `-${idPart}` : ""}.pdf`);
}
