/**
 * @file Generates the synthetic demo fixtures from `scripts/fixture-data.ts`.
 *
 * Writes, under `fixtures/`:
 * - `documents/*.pdf`: printed documents with a real text layer (bill, EOB, balance statement,
 *   broken-totals bill, prompt-injection bill);
 * - `llm-output/*.json`: the raw-level output a correct extraction model should return for each
 *   PDF (used for the no-AI demo path, unit tests with a mocked model, and the extraction eval);
 *
 * The patient's records are not generated: they are FinchNode's own synthetic records, saved in
 * `fixtures/finchnode/multi-source-overlap.json` (refresh with `npm run finchnode:check` output or the
 * demo API) and mapped by `lib/finchnode/live.ts`.
 * Run with `npm run fixtures`. Side effects: overwrites those files. Implements SPEC.md §6 MVP 0
 * (fixtures v1) and §5.7 (extraction test set, PDF variants).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import {
  BILL_LINES,
  BILL_SUBTITLE,
  BILL_TOTALS,
  BROKEN_TOTAL_CHARGES,
  CORRESPONDENCE,
  DENIAL,
  EOB,
  REVISED,
  type BillVariant,
  INJECTION_TEXT,
  VISIT,
} from "./fixture-data";

/** Root folder for generated fixtures. */
const ROOT = join(process.cwd(), "fixtures");

/** A raw-level field exactly as the extraction model is asked to return it. */
interface RawField {
  raw: string | null;
  page: number | null;
  snippet: string | null;
  status: "read" | "unreadable" | "absent";
}

/**
 * Builds a raw field read from page 1.
 *
 * @param raw - The value exactly as printed.
 * @param snippet - The printed text it was read from (a whole row or label line).
 * @returns A `read` raw field on page 1.
 */
function read(raw: string, snippet: string): RawField {
  return { raw, page: 1, snippet, status: "read" };
}

/** A raw field for a value the document does not contain. */
const ABSENT: RawField = { raw: null, page: null, snippet: null, status: "absent" };

/**
 * Formats one bill line as it is printed (a single text-layer string).
 *
 * @param l - The bill line definition.
 * @returns The printed row text.
 */
function billRow(l: (typeof BILL_LINES)[number]): string {
  return `${l.line.padEnd(3)} ${l.date}  ${l.code.padEnd(6)} ${l.description.padEnd(38)} ${l.qty.padStart(3)} ${l.charge.padStart(10)}`;
}

/**
 * Formats one EOB line as it is printed.
 *
 * @param l - The EOB line definition.
 * @returns The printed row text.
 */
function eobRow(l: (typeof EOB.lines)[number]): string {
  return `${l.date}  ${l.code.padEnd(6)} ${l.billed.padStart(10)} ${l.allowed.padStart(10)} ${l.planPaid.padStart(9)} ${l.patient.padStart(10)}`;
}

/**
 * Writes text lines to a one-page Letter PDF in Courier so rows stay aligned.
 *
 * @param lines - Text lines top to bottom; a line starting with "#" is drawn larger as a title.
 * @returns PDF bytes with a real text layer.
 */
async function makePdf(lines: string[]): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([612, 792]);
  const font = await pdf.embedFont(StandardFonts.Courier);
  const bold = await pdf.embedFont(StandardFonts.CourierBold);
  let y = 750;
  for (const line of lines) {
    const isTitle = line.startsWith("#");
    const text = isTitle ? line.slice(1).trim() : line;
    page.drawText(text, { x: 36, y, size: isTitle ? 13 : 8.5, font: isTitle ? bold : font, color: rgb(0, 0, 0) });
    y -= isTitle ? 20 : 13;
  }
  return pdf.save();
}

/** The original itemized bill as a variant. */
const ORIGINAL: BillVariant = { title: "Itemized Statement", statementDate: VISIT.statementDate, lines: BILL_LINES, totals: BILL_TOTALS };

/**
 * Printed lines of a bill.
 *
 * @param totalCharges - Total charges as printed (differs in the broken-totals variant).
 * @param v - Bill variant (original or revised statement).
 * @returns Text lines top to bottom.
 */
function billHeaderLines(totalCharges: string, v: BillVariant = ORIGINAL): string[] {
  return [
    `#${VISIT.entity} - ${v.title}`,
    BILL_SUBTITLE,
    `Patient: ${VISIT.patient}`,
    `Account #: ${VISIT.account}`,
    `Encounter: ${VISIT.encounter}`,
    `Service dates: ${VISIT.serviceStart} - ${VISIT.serviceEnd}`,
    `Statement date: ${v.statementDate}`,
    "",
    `Ln  Date        Code   Description                            Qty     Charge`,
    ...v.lines.map(billRow),
    "",
    `Total charges: ${totalCharges}`,
    `Adjustments: ${v.totals.totalAdjustments}`,
    `Payments: ${v.totals.totalPayments}`,
    `Amount due: ${v.totals.amountDue}`,
  ];
}

/**
 * Builds the expected raw-level model output for a bill.
 *
 * @param totalCharges - Total charges as printed (differs in the broken-totals variant).
 * @param v - Bill variant; the revised statement reports `docType: "revised_statement"`.
 * @returns The expected extraction object for the bill.
 */
function billOutput(totalCharges: string, v: BillVariant = ORIGINAL) {
  return {
    docType: v === ORIGINAL ? "itemized_bill" : "revised_statement",
    header: {
      billingEntity: read(VISIT.entity, `${VISIT.entity} - ${v.title}`),
      providerType: read("clinician", BILL_SUBTITLE),
      accountNumber: read(VISIT.account, `Account #: ${VISIT.account}`),
      patientName: read(VISIT.patient, `Patient: ${VISIT.patient}`),
      serviceStart: read(VISIT.serviceStart, `Service dates: ${VISIT.serviceStart} - ${VISIT.serviceEnd}`),
      serviceEnd: read(VISIT.serviceEnd, `Service dates: ${VISIT.serviceStart} - ${VISIT.serviceEnd}`),
      encounter: read(VISIT.encounter, `Encounter: ${VISIT.encounter}`),
      statementDate: read(v.statementDate, `Statement date: ${v.statementDate}`),
      totalCharges: read(totalCharges, `Total charges: ${totalCharges}`),
      totalAdjustments: read(v.totals.totalAdjustments, `Adjustments: ${v.totals.totalAdjustments}`),
      totalPayments: read(v.totals.totalPayments, `Payments: ${v.totals.totalPayments}`),
      amountDue: read(v.totals.amountDue, `Amount due: ${v.totals.amountDue}`),
    },
    lines: v.lines.map((l) => {
      const row = billRow(l);
      return {
        lineNumber: read(l.line, row),
        serviceDate: read(l.date, row),
        code: read(l.code, row),
        codeType: read(l.codeType, row),
        description: read(l.description, row),
        quantity: read(l.qty, row),
        unitPrice: ABSENT,
        charge: read(l.charge, row),
        adjustment: ABSENT,
        patientResponsibility: ABSENT,
      };
    }),
  };
}

/**
 * The prior-authorization denial letter (MVP 5) and its expected raw reply.
 *
 * @returns Printed lines and expected output.
 */
function denialDoc(): { lines: string[]; output: unknown } {
  const D = DENIAL;
  const L = {
    title: `${D.insurer} - Prior Authorization Decision`,
    member: `Member: ${D.memberName}   Member ID: ${D.memberId}`,
    ref: `Reference #: ${D.referenceNumber}   Date: ${D.letterDate}`,
    service: `Service requested: ${D.deniedService} (CPT ${D.serviceCode}) on ${D.plannedDate}`,
    provider: `Provider: ${D.provider}`,
    decision: `Decision: DENIED - ${D.denialReason}`,
    policy: `Policy: ${D.policyId} - ${D.policyTitle}. This policy requires:`,
    deadline: `You may appeal by ${D.appealDeadline}. Send your appeal to:`,
  };
  const lines = [
    `#${L.title}`,
    "SYNTHETIC DEMO DOCUMENT - NOT A REAL DECISION.",
    L.member,
    L.ref,
    "",
    L.service,
    L.provider,
    L.decision,
    "",
    L.policy,
    ...D.criteria,
    "Our review did not find documentation that these criteria are met.",
    "",
    L.deadline,
    D.appealAddress,
  ];
  const output = {
    docType: "denial_letter",
    insurer: read(D.insurer, L.title),
    memberName: read(D.memberName, L.member),
    memberId: read(D.memberId, L.member),
    referenceNumber: read(D.referenceNumber, L.ref),
    letterDate: read(D.letterDate, L.ref),
    deniedService: read(D.deniedService, L.service),
    serviceCode: read(D.serviceCode, L.service),
    plannedDate: read(D.plannedDate, L.service),
    provider: read(D.provider, L.provider),
    denialReason: read(D.denialReason, L.decision),
    policyId: read(D.policyId, L.policy),
    appealDeadline: read(D.appealDeadline, L.deadline),
    appealAddress: read(D.appealAddress, D.appealAddress),
  };
  return { lines, output };
}

/**
 * Generates every fixture file.
 *
 * @returns Resolves when all files are written.
 */
async function main(): Promise<void> {
  mkdirSync(join(ROOT, "documents"), { recursive: true });
  mkdirSync(join(ROOT, "llm-output"), { recursive: true });

  const docs: Record<string, { lines: string[]; output: unknown }> = {
    "sample-bill": { lines: billHeaderLines(BILL_TOTALS.totalCharges), output: billOutput(BILL_TOTALS.totalCharges) },
    "denial-letter": denialDoc(),
    "revised-statement": { lines: billHeaderLines(REVISED.totals.totalCharges, REVISED), output: billOutput(REVISED.totals.totalCharges, REVISED) },
    "bill-broken-totals": { lines: billHeaderLines(BROKEN_TOTAL_CHARGES), output: billOutput(BROKEN_TOTAL_CHARGES) },
    "bill-injection": {
      lines: [...billHeaderLines(BILL_TOTALS.totalCharges), "", INJECTION_TEXT],
      output: billOutput(BILL_TOTALS.totalCharges),
    },
    "balance-statement": {
      lines: [
        `#${VISIT.entity} - Statement`,
        "SYNTHETIC DEMO DOCUMENT - NOT A REAL BILL.",
        `Patient: ${VISIT.patient}`,
        `Account #: ${VISIT.account}`,
        `Statement date: ${VISIT.statementDate}`,
        "",
        `Balance due: ${BILL_TOTALS.amountDue}`,
        `Please remit payment by ${VISIT.dueDate}.`,
      ],
      output: {
        docType: "balance_statement",
        header: {
          billingEntity: read(VISIT.entity, `${VISIT.entity} - Statement`),
          providerType: { raw: null, page: null, snippet: null, status: "absent" },
          accountNumber: read(VISIT.account, `Account #: ${VISIT.account}`),
          patientName: read(VISIT.patient, `Patient: ${VISIT.patient}`),
          serviceStart: ABSENT,
          serviceEnd: ABSENT,
          encounter: ABSENT,
          statementDate: read(VISIT.statementDate, `Statement date: ${VISIT.statementDate}`),
          totalCharges: ABSENT,
          totalAdjustments: ABSENT,
          totalPayments: ABSENT,
          amountDue: read(BILL_TOTALS.amountDue, `Balance due: ${BILL_TOTALS.amountDue}`),
        },
        lines: [],
      },
    },
    "sample-eob": {
      lines: [
        `#${EOB.insurer} - Explanation of Benefits`,
        "THIS IS NOT A BILL. SYNTHETIC DEMO DOCUMENT.",
        `Member: ${VISIT.patient}`,
        `Claim #: ${EOB.claimNumber}`,
        `Provider: ${EOB.provider}`,
        "",
        "Date        Code       Billed    Allowed  Plan paid   You owe",
        ...EOB.lines.map(eobRow),
        "",
        `Total you owe: ${EOB.totalPatient}`,
      ],
      output: {
        docType: "eob",
        insurer: read(EOB.insurer, `${EOB.insurer} - Explanation of Benefits`),
        claimNumber: read(EOB.claimNumber, `Claim #: ${EOB.claimNumber}`),
        provider: read(EOB.provider, `Provider: ${EOB.provider}`),
        patientName: read(VISIT.patient, `Member: ${VISIT.patient}`),
        accountNumber: ABSENT,
        totalPatientResponsibility: read(EOB.totalPatient, `Total you owe: ${EOB.totalPatient}`),
        lines: EOB.lines.map((l) => {
          const row = eobRow(l);
          return {
            serviceDate: read(l.date, row),
            code: read(l.code, row),
            billed: read(l.billed, row),
            allowed: read(l.allowed, row),
            planPaid: read(l.planPaid, row),
            patientResponsibility: read(l.patient, row),
          };
        }),
      },
    },
  };

  for (const [name, d] of Object.entries(docs)) {
    writeFileSync(join(ROOT, "documents", `${name}.pdf`), await makePdf(d.lines));
    writeFileSync(join(ROOT, "llm-output", `${name}.json`), JSON.stringify(d.output, null, 2) + "\n");
  }
  for (const [name, c] of Object.entries(CORRESPONDENCE)) {
    writeFileSync(join(ROOT, "documents", `${name}.pdf`), await makePdf(c.lines));
  }
  console.log(`Wrote ${Object.keys(docs).length} documents with expected outputs and ${Object.keys(CORRESPONDENCE).length} correspondence PDFs to fixtures/`);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
