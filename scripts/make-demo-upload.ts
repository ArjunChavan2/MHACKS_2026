/**
 * @file Realistic-looking synthetic bill and EOB PDFs for the live-upload demo (read by Grok, not the
 * saved-answer sample path). Same story as `scripts/fixture-data.ts` (Priya Ramaswamy, Quillhaven
 * visit 03/05/2026: duplicate TSH, bill over EOB by $68, free T4 without a same-day record).
 * Fictional organizations and addresses; every page says SYNTHETIC. Run: `npx tsx scripts/make-demo-upload.ts`.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { BILL_LINES, BILL_TOTALS, EOB, VISIT } from "./fixture-data";

const OUT = join(process.cwd(), "fixtures", "demo-upload");
const NAVY = rgb(0.12, 0.2, 0.36);
const GREY = rgb(0.45, 0.45, 0.45);
const LIGHT = rgb(0.93, 0.95, 0.98);

/** Draws text at a position. */
function t(page: PDFPage, s: string, x: number, y: number, font: PDFFont, size = 9, color = rgb(0, 0, 0)) {
  page.drawText(s, { x, y, size, font, color });
}

/** Draws text right-aligned at x. */
function tr(page: PDFPage, s: string, x: number, y: number, font: PDFFont, size = 9) {
  t(page, s, x - font.widthOfTextAtSize(s, size), y, font, size);
}

/** Common page setup: header band and synthetic footer. */
async function base(title: string, org: string, orgLines: string[]) {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([612, 792]);
  const reg = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  page.drawRectangle({ x: 0, y: 712, width: 612, height: 80, color: NAVY });
  t(page, org, 40, 760, bold, 16, rgb(1, 1, 1));
  orgLines.forEach((l, i) => t(page, l, 40, 744 - i * 11, reg, 8, rgb(0.85, 0.88, 0.95)));
  page.drawText(title, { x: 572 - bold.widthOfTextAtSize(title, 13), y: 760, size: 13, font: bold, color: rgb(1, 1, 1) });
  t(page, "SYNTHETIC DEMO DOCUMENT - NOT A REAL BILL OR RECORD. Fictional organizations and patient.", 40, 30, reg, 7, GREY);
  return { pdf, page, reg, bold };
}

/** The itemized bill. */
async function bill(): Promise<Uint8Array> {
  const { pdf, page, reg, bold } = await base("ITEMIZED STATEMENT", VISIT.entity, ["Professional charges", "2400 Quillhaven Way, Ann Arbor, MI 48104 (fictional)", "Billing questions: 734-555-0142"]);
  const rows: Array<[string, string]> = [
    ["Patient", VISIT.patient], ["Account #", VISIT.account], ["Encounter", VISIT.encounter],
    ["Service dates", `${VISIT.serviceStart} - ${VISIT.serviceEnd}`], ["Statement date", VISIT.statementDate],
  ];
  rows.forEach(([k, v], i) => { t(page, `${k}:`, 40, 680 - i * 14, bold, 9); t(page, v, 130, 680 - i * 14, reg, 9); });
  page.drawRectangle({ x: 380, y: 618, width: 192, height: 74, color: LIGHT });
  t(page, "AMOUNT DUE", 392, 674, bold, 9, NAVY);
  t(page, BILL_TOTALS.amountDue, 392, 646, bold, 22, NAVY);
  t(page, "Please pay by 04/20/2026", 392, 628, reg, 8, GREY);
  let y = 590;
  page.drawRectangle({ x: 40, y: y - 4, width: 532, height: 18, color: NAVY });
  const head = (s: string, x: number, right = false) => (right ? page.drawText(s, { x: x - bold.widthOfTextAtSize(s, 8), y: y + 1, size: 8, font: bold, color: rgb(1, 1, 1) }) : page.drawText(s, { x, y: y + 1, size: 8, font: bold, color: rgb(1, 1, 1) }));
  head("Ln", 46); head("Date", 70); head("Code", 135); head("Description", 185); head("Qty", 470, true); head("Charge", 566, true);
  for (const [i, l] of BILL_LINES.entries()) {
    y -= 20;
    if (i % 2 === 1) page.drawRectangle({ x: 40, y: y - 5, width: 532, height: 18, color: LIGHT });
    t(page, l.line, 46, y, reg); t(page, l.date, 70, y, reg); t(page, l.code, 135, y, reg); t(page, l.description, 185, y, reg);
    tr(page, l.qty, 470, y, reg); tr(page, l.charge, 566, y, reg);
  }
  y -= 34;
  const tot: Array<[string, string, boolean]> = [["Total charges:", BILL_TOTALS.totalCharges, false], ["Adjustments:", BILL_TOTALS.totalAdjustments, false], ["Payments:", BILL_TOTALS.totalPayments, false], ["Amount due:", BILL_TOTALS.amountDue, true]];
  for (const [k, v, b] of tot) { tr(page, k, 480, y, b ? bold : reg, 10); tr(page, v, 566, y, b ? bold : reg, 10); y -= 16; }
  return pdf.save();
}

/** The EOB. */
async function eob(): Promise<Uint8Array> {
  const { pdf, page, reg, bold } = await base("EXPLANATION OF BENEFITS", EOB.insurer, ["THIS IS NOT A BILL", "P.O. Box 4410, Ann Arbor, MI 48106 (fictional)", "Member services: 1-800-555-0199"]);
  const rows: Array<[string, string]> = [["Member", VISIT.patient], ["Claim #", EOB.claimNumber], ["Provider", EOB.provider], ["Date processed", "03/18/2026"]];
  rows.forEach(([k, v], i) => { t(page, `${k}:`, 40, 680 - i * 14, bold, 9); t(page, v, 130, 680 - i * 14, reg, 9); });
  page.drawRectangle({ x: 380, y: 624, width: 192, height: 68, color: LIGHT });
  t(page, "YOU MAY OWE", 392, 674, bold, 9, NAVY);
  t(page, EOB.totalPatient, 392, 646, bold, 22, NAVY);
  t(page, "THIS IS NOT A BILL", 392, 632, bold, 8, GREY);
  let y = 590;
  page.drawRectangle({ x: 40, y: y - 4, width: 532, height: 18, color: NAVY });
  const cols: Array<[string, number]> = [["Date", 46], ["Code", 120], ["Billed", 260], ["Allowed", 350], ["Plan paid", 450], ["You owe", 566]];
  for (const [s, x] of cols) {
    const w = bold.widthOfTextAtSize(s, 8);
    page.drawText(s, { x: x > 200 ? x - w : x, y: y + 1, size: 8, font: bold, color: rgb(1, 1, 1) });
  }
  for (const [i, l] of EOB.lines.entries()) {
    y -= 20;
    if (i % 2 === 1) page.drawRectangle({ x: 40, y: y - 5, width: 532, height: 18, color: LIGHT });
    t(page, l.date, 46, y, reg); t(page, l.code, 120, y, reg);
    tr(page, l.billed, 260, y, reg); tr(page, l.allowed, 350, y, reg); tr(page, l.planPaid, 450, y, reg); tr(page, l.patient, 566, y, reg);
  }
  y -= 34;
  tr(page, "Total you owe:", 480, y, bold, 10); tr(page, EOB.totalPatient, 566, y, bold, 10);
  t(page, "Amounts apply to your deductible. Keep this statement for your records.", 40, y - 30, reg, 8, GREY);
  return pdf.save();
}

/** Writes both files. */
async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "quillhaven-bill.pdf"), await bill());
  writeFileSync(join(OUT, "wolverine-eob.pdf"), await eob());
  console.log(`Wrote ${OUT}/quillhaven-bill.pdf and wolverine-eob.pdf`);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
