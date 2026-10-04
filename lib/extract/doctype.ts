/**
 * @file Code checks on the model's document type (GitHub issue #5, weak spot 1).
 *
 * The classifier's label alone decides how a document is read and audited, so a random invoice
 * read as a medical bill, or an EOB read as a bill, would produce confident nonsense. These checks
 * test what was actually extracted (works for photos too) and, for PDFs with a text layer, what the
 * document itself says. Any failure becomes a `typeIssues` message that blocks confirmation until
 * the patient confirms the type. Pure and deterministic; never uses a model.
 */
import type { ExtractedBill, ExtractedEob } from "@/lib/types";
import { codeFormatIssue } from "./checks";
import type { TextLayer } from "./textLayer";

/** Wording an EOB uses to say what it is. At least one must be printed on a PDF read as an EOB. */
const EOB_WORDING = /explanation of benefits|\bnot a bill\b|\beob\b|(statement|summary) of (health )?benefits|benefits? statement/;

/** Wording that says a document is not a bill (EOBs print it). Never printed on a real bill. */
const NOT_A_BILL = /\bnot a bill\b/;

/** Medical-billing wording; a PDF read as a bill with none of these is probably some other invoice. */
const MEDICAL_WORDING =
  /\bpatient\b|\bcpt\b|\bhcpcs\b|date of service|service date|\bprocedure\b|\bdiagnosis\b|\bhospital\b|\bclinic\b|\bphysician\b|\bmedical\b|\bhealth\b|\binsurance\b|\binsurer\b|revenue code|\blab(oratory)?\b|\bvisit\b|\bencounter\b|\bguarantor\b/;

/**
 * Joins a PDF text layer into one lowercase string.
 *
 * @param layer - Per-page text, or `null`.
 * @returns The whole text, or `null` for photos and scans.
 */
function fullText(layer: TextLayer): string | null {
  return layer ? layer.join(" ").toLowerCase() : null;
}

/**
 * Checks that a document read as an itemized bill, revised statement, or balance statement really
 * looks like a medical bill.
 *
 * @param bill - Extracted bill (normalized values).
 * @param layer - Per-page PDF text, or `null` for photos and scans (text checks are skipped).
 * @returns Plain-language reasons to doubt the type; empty when it looks right.
 */
export function billTypeIssues(bill: ExtractedBill, layer: TextLayer): string[] {
  const out: string[] = [];
  const kind = bill.docType === "balance_statement" ? "balance statement" : "medical bill";
  const text = fullText(layer);
  if (text && NOT_A_BILL.test(text)) {
    out.push(`The document says it is "not a bill" (as an EOB does), but it was read as a ${kind}.`);
  }
  if (text && !MEDICAL_WORDING.test(text)) {
    out.push(`The document never mentions a patient, service date, procedure, or other medical-billing term, so it may not be a ${kind}.`);
  }
  const h = bill.header;
  if (h.patientName.value === null && h.accountNumber.value === null) {
    out.push(`No patient name or account number was found, which every ${kind} prints.`);
  }
  const coded = bill.lines.filter((l) => l.code.value && !codeFormatIssue(l.code.value, null));
  if (bill.docType !== "balance_statement" && bill.lines.length && !coded.length) {
    out.push("None of the line items has a medical billing code (CPT, HCPCS, revenue code, or NDC), so this may not be a medical bill.");
  }
  return out;
}

/**
 * Checks that a document read as an EOB really looks like one.
 *
 * @param eob - Extracted EOB (normalized values).
 * @param layer - Per-page PDF text, or `null` for photos and scans (text checks are skipped).
 * @returns Plain-language reasons to doubt the type; empty when it looks right.
 */
export function eobTypeIssues(eob: ExtractedEob, layer: TextLayer): string[] {
  const out: string[] = [];
  const text = fullText(layer);
  if (text && !EOB_WORDING.test(text)) {
    out.push('The document never says "explanation of benefits" or "this is not a bill", which EOBs print, so it may not be an EOB.');
  }
  if (eob.insurer.value === null) out.push("No insurer name was found, which every EOB prints.");
  if (eob.lines.length && !eob.lines.some((l) => l.allowed.value !== null || l.planPaid.value !== null)) {
    out.push("No line shows an allowed amount or what the plan paid, which every EOB shows.");
  }
  return out;
}
