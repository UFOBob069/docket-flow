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

const MARGIN = 48;
const PAGE_BOTTOM = 48;
const LINE = 14;
const SECTION_GAP = 10;

function safeFilenamePart(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

function ensureSpace(doc: jsPDF, y: number, needed: number): number {
  const pageHeight = doc.internal.pageSize.getHeight();
  if (y + needed <= pageHeight - PAGE_BOTTOM) return y;
  doc.addPage();
  return MARGIN;
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

function drawSectionTitle(doc: jsPDF, title: string, y: number, pageWidth: number): number {
  y = ensureSpace(doc, y, LINE + 8);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(20, 24, 32);
  doc.text(title, MARGIN, y);
  y += 4;
  doc.setDrawColor(200, 205, 214);
  doc.setLineWidth(0.6);
  doc.line(MARGIN, y, pageWidth - MARGIN, y);
  return y + 12;
}

function drawLabelValue(
  doc: jsPDF,
  label: string,
  value: string,
  y: number,
  pageWidth: number
): number {
  const maxWidth = pageWidth - MARGIN * 2;
  y = ensureSpace(doc, y, LINE);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(90, 98, 112);
  doc.text(label, MARGIN, y);
  y += LINE - 2;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(20, 24, 32);
  return drawWrapped(doc, value, MARGIN, y, maxWidth) + 4;
}

function drawTwoColumnRow(
  doc: jsPDF,
  leftLabel: string,
  leftValue: string,
  rightLabel: string,
  rightValue: string,
  y: number,
  pageWidth: number
): number {
  const colGap = 16;
  const colWidth = (pageWidth - MARGIN * 2 - colGap) / 2;
  const leftX = MARGIN;
  const rightX = MARGIN + colWidth + colGap;

  const leftLines = doc.splitTextToSize(leftValue || "—", colWidth) as string[];
  const rightLines = doc.splitTextToSize(rightValue || "—", colWidth) as string[];
  const blockHeight = LINE + Math.max(leftLines.length, rightLines.length) * LINE + 4;
  y = ensureSpace(doc, y, blockHeight);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.setTextColor(90, 98, 112);
  doc.text(leftLabel, leftX, y);
  doc.text(rightLabel, rightX, y);
  y += LINE - 2;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(20, 24, 32);
  const yLeftStart = y;
  let yLeft = y;
  for (const line of leftLines) {
    doc.text(line, leftX, yLeft);
    yLeft += LINE;
  }
  let yRight = yLeftStart;
  for (const line of rightLines) {
    doc.text(line, rightX, yRight);
    yRight += LINE;
  }
  return Math.max(yLeft, yRight) + 4;
}

export async function downloadIntakePdf(intake: IntakeFlat, pageUrl: string): Promise<void> {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  const pageWidth = doc.internal.pageSize.getWidth();
  let y = MARGIN;

  const name = intake.name?.trim() || "Unnamed intake";
  const generatedAt = new Date().toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.setTextColor(20, 24, 32);
  doc.text("DocketFlow Intake", MARGIN, y);
  y += 22;

  doc.setFontSize(14);
  doc.text(name, MARGIN, y);
  y += 18;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(90, 98, 112);
  y = drawWrapped(
    doc,
    [
      intake.phone?.trim() ? `Phone: ${intake.phone.trim()}` : null,
      `Intake: ${formatIntakeWhen(intake.created_at)}`,
      intake.accident_date?.trim() ? `Accident: ${intake.accident_date.trim()}` : null,
      intake.case_id ? "Status: Promoted" : "Status: Open",
      intake.how_found?.trim() ? `Source: ${intake.how_found.trim()}` : null,
      `Generated: ${generatedAt}`,
    ]
      .filter(Boolean)
      .join("  ·  "),
    MARGIN,
    y,
    pageWidth - MARGIN * 2,
    12
  );
  y += 6;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(90, 98, 112);
  doc.text("Intake page", MARGIN, y);
  y += 12;
  doc.setFont("helvetica", "normal");
  doc.setTextColor(37, 99, 235);
  const linkLines = doc.splitTextToSize(pageUrl, pageWidth - MARGIN * 2) as string[];
  for (const line of linkLines) {
    y = ensureSpace(doc, y, 12);
    doc.textWithLink(line, MARGIN, y, { url: pageUrl });
    y += 12;
  }
  doc.setTextColor(20, 24, 32);
  y += SECTION_GAP;

  y = drawSectionTitle(doc, "Case overview", y, pageWidth);
  y = drawLabelValue(doc, "Summary", buildIncidentSummary(intake), y, pageWidth);
  y = drawTwoColumnRow(
    doc,
    "Injuries",
    formatIntakeValue(intake.injury_types),
    "Treatment",
    intakeTreatmentStatus(intake),
    y,
    pageWidth
  );
  y = drawTwoColumnRow(
    doc,
    "Accident date",
    formatIntakeValue(intake.accident_date),
    "Location",
    intakeLocationLine(intake) ?? "Not provided",
    y,
    pageWidth
  );
  y = drawTwoColumnRow(
    doc,
    "Insurance",
    intakeInsuranceStatus(intake),
    "Representation",
    intakeRepresentationStatus(intake),
    y,
    pageWidth
  );
  y = drawTwoColumnRow(
    doc,
    "Police / report",
    intakePoliceStatus(intake),
    "Employer",
    formatIntakeValue(intake.employer),
    y,
    pageWidth
  );
  y += SECTION_GAP;

  const missing = getMissingIntakeFields(intake);
  if (missing.length > 0) {
    y = drawSectionTitle(doc, `Missing information (${missing.length})`, y, pageWidth);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    for (const item of missing) {
      y = ensureSpace(doc, y, LINE);
      doc.text(`• ${item.label}`, MARGIN, y);
      y += LINE;
    }
    y += SECTION_GAP;
  }

  for (const section of INTAKE_DETAIL_SECTIONS) {
    y = drawSectionTitle(doc, section.title, y, pageWidth);
    for (let i = 0; i < section.fields.length; i += 2) {
      const left = section.fields[i];
      const right = section.fields[i + 1];
      if (left.multiline || !right) {
        y = drawLabelValue(doc, left.label, formatIntakeValue(intake[left.key]), y, pageWidth);
        if (right) {
          y = drawLabelValue(doc, right.label, formatIntakeValue(intake[right.key]), y, pageWidth);
        }
      } else {
        y = drawTwoColumnRow(
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
  }

  if (intake.notes?.trim()) {
    y = drawSectionTitle(doc, "Internal notes", y, pageWidth);
    y = drawLabelValue(doc, "Notes", intake.notes.trim(), y, pageWidth);
    y += SECTION_GAP;
  }

  y = drawSectionTitle(doc, "Source link", y, pageWidth);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(37, 99, 235);
  const footerLines = doc.splitTextToSize(pageUrl, pageWidth - MARGIN * 2) as string[];
  for (const line of footerLines) {
    y = ensureSpace(doc, y, 12);
    doc.textWithLink(line, MARGIN, y, { url: pageUrl });
    y += 12;
  }

  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i += 1) {
    doc.setPage(i);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(140, 146, 158);
    doc.text(
      `DocketFlow intake · Page ${i} of ${pageCount}`,
      MARGIN,
      doc.internal.pageSize.getHeight() - 24
    );
  }

  const base = safeFilenamePart(name) || "intake";
  const idPart = safeFilenamePart(intake.call_id || intake.id).slice(0, 18);
  doc.save(`intake-${base}${idPart ? `-${idPart}` : ""}.pdf`);
}
