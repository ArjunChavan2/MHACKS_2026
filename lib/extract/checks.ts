/**
 * @file Deterministic validation checks and confidence (SPEC.md §4.2 steps 4–6).
 *
 * Each failed check adds an issue to the specific field (or to `documentIssues` for whole-document
 * problems). A field is `verified` only if it has no issues; otherwise it `needs_attention`. The
 * model's own confidence is never used. All functions here are pure except that they mutate the
 * extraction object passed in (documented per function).
 */
import type { BillLine, ExtractedBill, ExtractedEob, Field } from "@/lib/types";
import { usd } from "@/lib/format";
import { crossCheck, type TextLayer } from "./textLayer";

export { usd };

/** CPT: 5 digits, or 4 digits plus F/T/U (Category II/III/PLA). Format only (SPEC.md §4.2 step 5). */
const CPT_RE = /^\d{4}[0-9FTU]$/;
/** HCPCS Level II: one letter A–V plus 4 digits. */
const HCPCS_RE = /^[A-V]\d{4}$/;
/** Revenue code: 4 digits (often printed with a leading 0). */
const REV_RE = /^\d{4}$/;
/** NDC: 10–11 digits with optional hyphens. */
const NDC_RE = /^(\d{4,5}-\d{3,4}-\d{1,2}|\d{10,11})$/;

/**
 * Adds an issue to a field and marks it as needing attention.
 *
 * Mutates `field`.
 *
 * @param field - Field to flag.
 * @param issue - Human-readable reason.
 */
export function flag<T>(field: Field<T>, issue: string): void {
  field.issues.push(issue);
  field.verification = "needs_attention";
}

/**
 * Checks a billing code's format against its code type. Never validates against the CPT code set,
 * which is licensed by the AMA.
 *
 * @param code - Code as normalized.
 * @param codeType - Declared code type.
 * @returns An issue message, or `null` when the format is plausible.
 */
export function codeFormatIssue(code: string, codeType: string | null): string | null {
  const c = code.toUpperCase();
  const ok =
    codeType === "CPT" ? CPT_RE.test(c) :
    codeType === "HCPCS" ? HCPCS_RE.test(c) :
    codeType === "REV" ? REV_RE.test(c) :
    codeType === "NDC" ? NDC_RE.test(c) :
    CPT_RE.test(c) || HCPCS_RE.test(c) || REV_RE.test(c) || NDC_RE.test(c);
  return ok ? null : `code "${code}" does not look like a valid ${codeType ?? "billing"} code`;
}

/**
 * Lists every field of a bill with a path label, for generic checks and the confirm screen.
 *
 * @param bill - Extracted bill.
 * @returns Pairs of `[path, field]`, e.g. `["lines.3.charge", field]`.
 */
export function billFields(bill: ExtractedBill): Array<[string, Field<unknown>]> {
  const out: Array<[string, Field<unknown>]> = Object.entries(bill.header).map(([k, f]) => [`header.${k}`, f]);
  bill.lines.forEach((line, i) => {
    for (const [k, f] of Object.entries(line)) out.push([`lines.${i}.${k}`, f as Field<unknown>]);
  });
  return out;
}

/**
 * Lists every field of an EOB with a path label.
 *
 * @param eob - Extracted EOB.
 * @returns Pairs of `[path, field]`.
 */
export function eobFields(eob: ExtractedEob): Array<[string, Field<unknown>]> {
  const out: Array<[string, Field<unknown>]> = [
    ["insurer", eob.insurer],
    ["claimNumber", eob.claimNumber],
    ["provider", eob.provider],
    // Absent on EOBs extracted before schema raw-v2.
    ...(eob.patientName ? [["patientName", eob.patientName] as [string, Field<unknown>]] : []),
    ...(eob.accountNumber ? [["accountNumber", eob.accountNumber] as [string, Field<unknown>]] : []),
    ["totalPatientResponsibility", eob.totalPatientResponsibility],
  ];
  eob.lines.forEach((line, i) => {
    for (const [k, f] of Object.entries(line)) out.push([`lines.${i}.${k}`, f as Field<unknown>]);
  });
  return out;
}

/**
 * Runs the text-layer cross-check on every read field.
 *
 * Mutates the fields. Skipped entirely when `layer` is `null` (photo or scan).
 *
 * @param fields - Path/field pairs.
 * @param layer - Per-page PDF text, or `null`.
 */
export function applyTextLayer(fields: Array<[string, Field<unknown>]>, layer: TextLayer): void {
  if (!layer) return;
  for (const [, f] of fields) {
    if (f.status !== "read" || f.raw === null) continue;
    const issue = crossCheck(layer, f.page, f.raw, f.snippet);
    if (issue) flag(f, issue);
  }
}

/**
 * Runs the bill checks (SPEC.md §4.2 step 5) and sets verification on every field.
 *
 * Mutates `bill` (adds issues and document issues).
 *
 * @param bill - Extracted bill with normalized values.
 * @param layer - Per-page PDF text, or `null` for photos and scans.
 * @returns The same bill, for chaining.
 */
export function checkBill(bill: ExtractedBill, layer: TextLayer): ExtractedBill {
  const h = bill.header;
  // Labels assigned by the model are not printed text, so they are excluded from the text-layer check.
  const printed = billFields(bill).filter(([p]) => !p.endsWith("codeType") && !p.endsWith("providerType"));
  applyTextLayer(printed, layer);

  const seen = new Set<number>();
  bill.lines.forEach((line: BillLine, i) => {
    const label = `Line ${line.lineNumber.value ?? i + 1}`;
    if (line.lineNumber.value !== null) {
      if (seen.has(line.lineNumber.value)) flag(line.lineNumber, `${label}: line number appears more than once`);
      seen.add(line.lineNumber.value);
    }
    if (line.code.value) {
      const issue = codeFormatIssue(line.code.value, line.codeType.value);
      if (issue) flag(line.code, `${label}: ${issue}`);
    }
    if (line.charge.value === null && line.charge.status !== "unreadable") flag(line.charge, `${label}: charge is missing`);
    if (line.charge.value !== null && line.charge.value < 0) flag(line.charge, `${label}: charge is negative`);
    if (line.adjustment.value !== null && line.adjustment.value > 0) {
      flag(line.adjustment, `${label}: adjustment is positive; adjustments normally reduce the bill`);
    }
    const q = line.quantity.value;
    const u = line.unitPrice.value;
    const c = line.charge.value;
    if (q !== null && u !== null && c !== null && q * u !== c) {
      flag(line.charge, `${label}: quantity × unit price (${q} × ${usd(u)}) does not equal the charge ${usd(c)}`);
    }
    const sd = line.serviceDate.value;
    if (sd && h.serviceStart.value && h.serviceEnd.value && (sd < h.serviceStart.value || sd > h.serviceEnd.value)) {
      flag(line.serviceDate, `${label}: service date is outside the bill's service range`);
    }
  });

  if (h.serviceStart.value && h.serviceEnd.value && h.serviceStart.value > h.serviceEnd.value) {
    flag(h.serviceEnd, "Service end date is before the start date");
  }

  const charges = bill.lines.map((l) => l.charge.value);
  if (bill.lines.length && h.totalCharges.value !== null && charges.every((c) => c !== null)) {
    const sum = (charges as number[]).reduce((a, b) => a + b, 0);
    if (sum !== h.totalCharges.value) {
      const msg = `Line charges add up to ${usd(sum)}, but the bill says total charges are ${usd(h.totalCharges.value)}`;
      flag(h.totalCharges, msg);
      bill.documentIssues.push(msg);
    }
  }

  const t = h.totalCharges.value;
  const due = h.amountDue.value;
  if (t !== null && due !== null) {
    const adj = h.totalAdjustments.value ?? 0;
    const pay = h.totalPayments.value ?? 0;
    // Adjustments and payments may be printed as negatives or as positive credits; accept either.
    const expected = t - Math.abs(adj) - Math.abs(pay);
    if (expected !== due) {
      const msg = `Total charges ${usd(t)} minus adjustments ${usd(Math.abs(adj))} and payments ${usd(Math.abs(pay))} is ${usd(expected)}, but the bill says ${usd(due)} is due`;
      flag(h.amountDue, msg);
      bill.documentIssues.push(msg);
    }
  }
  if (bill.docType !== "balance_statement" && bill.lines.length === 0) {
    bill.documentIssues.push("No line items were found on an itemized bill");
  }
  return bill;
}

/**
 * Runs the EOB checks and sets verification on every field.
 *
 * Mutates `eob`.
 *
 * @param eob - Extracted EOB with normalized values.
 * @param layer - Per-page PDF text, or `null`.
 * @returns The same EOB, for chaining.
 */
export function checkEob(eob: ExtractedEob, layer: TextLayer): ExtractedEob {
  applyTextLayer(eobFields(eob), layer);
  const owed = eob.lines.map((l) => l.patientResponsibility.value);
  const total = eob.totalPatientResponsibility.value;
  if (eob.lines.length && total !== null && owed.every((o) => o !== null)) {
    const sum = (owed as number[]).reduce((a, b) => a + b, 0);
    if (sum !== total) {
      const msg = `EOB lines add up to ${usd(sum)} owed, but the EOB total says ${usd(total)}`;
      flag(eob.totalPatientResponsibility, msg);
      eob.documentIssues.push(msg);
    }
  }
  eob.lines.forEach((l, i) => {
    const { billed, allowed } = l;
    if (billed.value !== null && allowed.value !== null && allowed.value > billed.value) {
      flag(allowed, `EOB line ${i + 1}: allowed amount is higher than billed`);
    }
  });
  return eob;
}

/**
 * Lists fields that still need attention, for the confirm screen ordering.
 *
 * @param fields - Path/field pairs.
 * @returns Paths of fields needing attention, in document order.
 */
export function needsAttention(fields: Array<[string, Field<unknown>]>): string[] {
  return fields.filter(([, f]) => f.verification === "needs_attention").map(([p]) => p);
}
