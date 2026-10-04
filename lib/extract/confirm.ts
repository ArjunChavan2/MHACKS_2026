/**
 * @file Patient confirmation: the only way to create a `ConfirmedBill` or `ConfirmedEob`
 * (SPEC.md §4.2 steps 7–8, §5.6).
 *
 * The patient corrects fields or confirms them as printed. Corrected values are re-normalized and
 * re-checked. Confirmation is blocked while any field still needs attention and was neither
 * corrected nor explicitly confirmed, while the printed totals don't reconcile and the patient
 * has not acknowledged that the bill itself doesn't add up, or while the type checks doubt the
 * model's document type and the patient has not confirmed it. Never audit unconfirmed data.
 */
import type {
  ConfirmedBill,
  ConfirmedEob,
  ExtractedBill,
  ExtractedEob,
  Field,
} from "@/lib/types";
import { buildBill, buildEob } from "./build";
import { billFields, eobFields } from "./checks";
import type { RawBill, RawEob, RawField } from "./schemas";

/** What the patient did on the confirm screen. */
export interface ConfirmInput {
  /** Document ID the extraction belongs to. */
  documentId: string;
  /** New raw text per field path (e.g. "lines.6.charge" → "$142.00"); `null` marks a field absent. */
  corrections: Record<string, string | null>;
  /** Paths the patient explicitly confirmed as printed even though they needed attention. */
  confirmedPaths: string[];
  /** Patient confirms the printed totals themselves don't add up (bill issue, not a reading error). */
  acknowledgeTotalsMismatch: boolean;
  /** Patient confirms the document type even though the type checks doubted it (`typeIssues`). */
  acknowledgeDocType?: boolean;
}

/** Stand-in for EOB fields missing from extractions stored before schema `raw-v2`. */
const ABSENT: Field<unknown> = { raw: null, value: null, page: null, snippet: null, status: "absent", verification: "verified", issues: [] };

/** Result of a confirmation attempt. */
export type ConfirmResult<T> = { ok: true; value: T } | { ok: false; blocking: string[] };

/**
 * Converts a field back to its raw form, applying a correction if one exists for its path.
 *
 * @param f - Extracted field.
 * @param path - Field path.
 * @param corrections - Patient corrections.
 * @returns The raw field to rebuild from.
 */
export function rawOf(f: Field<unknown>, path: string, corrections: Record<string, string | null>): RawField {
  if (path in corrections) {
    const v = corrections[path];
    return v === null
      ? { raw: null, page: f.page, snippet: f.snippet, status: "absent" }
      : { raw: v, page: f.page, snippet: f.snippet, status: "read" };
  }
  return { raw: f.raw, page: f.page, snippet: f.snippet, status: f.status };
}

/**
 * Lists fields that still block confirmation.
 *
 * @param fields - Rebuilt path/field pairs.
 * @param input - Patient actions.
 * @returns Blocking messages (empty when everything is resolved).
 */
export function blockingFields(fields: Array<[string, Field<unknown>]>, input: ConfirmInput): string[] {
  const totalsPaths = new Set(["header.totalCharges", "header.amountDue", "totalPatientResponsibility"]);
  return fields
    .filter(([p, f]) => f.verification === "needs_attention" && !input.confirmedPaths.includes(p))
    .filter(([p]) => !(input.acknowledgeTotalsMismatch && totalsPaths.has(p)))
    .flatMap(([, f]) => f.issues);
}

/**
 * Lists the type doubts that still block confirmation. They come from the original extraction
 * (which had the PDF text layer); corrections don't clear them, only the patient's acknowledgement.
 *
 * @param typeIssues - Stored type doubts, if any.
 * @param input - Patient actions.
 * @returns Blocking messages.
 */
function typeBlocking(typeIssues: string[] | undefined, input: ConfirmInput): string[] {
  return typeIssues?.length && !input.acknowledgeDocType ? typeIssues : [];
}

/**
 * Confirms a bill: applies corrections, re-checks, and returns a `ConfirmedBill` or what blocks it.
 *
 * Corrected values are re-checked without the text layer (the patient's value need not be printed).
 * Pure: returns new objects.
 *
 * @param extracted - The checked extraction shown on the confirm screen.
 * @param input - Corrections, explicit confirmations, and the totals acknowledgement.
 * @returns `{ ok: true, value }` with the locked confirmed bill, or `{ ok: false, blocking }`.
 */
export function confirmBill(extracted: ExtractedBill, input: ConfirmInput): ConfirmResult<ConfirmedBill> {
  const header = Object.fromEntries(
    Object.entries(extracted.header).map(([k, f]) => [k, rawOf(f, `header.${k}`, input.corrections)]),
  ) as RawBill["header"];
  const lines = extracted.lines.map((line, i) =>
    Object.fromEntries(Object.entries(line).map(([k, f]) => [k, rawOf(f as Field<unknown>, `lines.${i}.${k}`, input.corrections)])),
  ) as RawBill["lines"];
  const rebuilt = buildBill({ docType: extracted.docType, header, lines }, null);

  const blocking = [...typeBlocking(extracted.typeIssues, input), ...blockingFields(billFields(rebuilt), input)];
  if (rebuilt.documentIssues.length && !input.acknowledgeTotalsMismatch) blocking.push(...rebuilt.documentIssues);
  rebuilt.lines.forEach((l, i) => {
    if (l.charge.value === null) blocking.push(`Line ${i + 1}: a charge amount is required`);
  });
  if (rebuilt.docType === "balance_statement") {
    blocking.push("A balance statement has no line items to audit. Request the itemized bill first.");
  }
  if (blocking.length) return { ok: false, blocking: [...new Set(blocking)] };

  const h = rebuilt.header;
  return {
    ok: true,
    value: Object.freeze({
      confirmed: true as const,
      documentId: input.documentId,
      billingEntity: h.billingEntity.value ?? "the provider",
      providerType: h.providerType.value ?? "other",
      accountNumber: h.accountNumber.value,
      patientName: h.patientName.value,
      serviceStart: h.serviceStart.value,
      serviceEnd: h.serviceEnd.value,
      encounter: h.encounter.value,
      totalChargesCents: h.totalCharges.value,
      amountDueCents: h.amountDue.value,
      totalsMismatchAcknowledged: rebuilt.documentIssues.length > 0 && input.acknowledgeTotalsMismatch,
      lines: rebuilt.lines.map((l, i) => ({
        lineNumber: l.lineNumber.value ?? i + 1,
        serviceDate: l.serviceDate.value,
        code: l.code.value,
        codeType: l.codeType.value ?? "unknown",
        description: l.description.value ?? "",
        quantity: l.quantity.value ?? 1,
        unitPriceCents: l.unitPrice.value,
        chargeCents: l.charge.value as number,
        adjustmentCents: l.adjustment.value,
        patientResponsibilityCents: l.patientResponsibility.value,
        provenance: { page: l.charge.page, snippet: l.charge.snippet },
      })),
    }),
  };
}

/**
 * Confirms an EOB the same way as a bill.
 *
 * @param extracted - The checked EOB extraction.
 * @param input - Patient actions.
 * @returns The locked confirmed EOB, or what blocks it.
 */
export function confirmEob(extracted: ExtractedEob, input: ConfirmInput): ConfirmResult<ConfirmedEob> {
  const raw: RawEob = {
    docType: "eob",
    insurer: rawOf(extracted.insurer, "insurer", input.corrections),
    claimNumber: rawOf(extracted.claimNumber, "claimNumber", input.corrections),
    provider: rawOf(extracted.provider, "provider", input.corrections),
    patientName: rawOf(extracted.patientName ?? ABSENT, "patientName", input.corrections),
    accountNumber: rawOf(extracted.accountNumber ?? ABSENT, "accountNumber", input.corrections),
    totalPatientResponsibility: rawOf(extracted.totalPatientResponsibility, "totalPatientResponsibility", input.corrections),
    lines: extracted.lines.map((line, i) =>
      Object.fromEntries(Object.entries(line).map(([k, f]) => [k, rawOf(f as Field<unknown>, `lines.${i}.${k}`, input.corrections)])),
    ) as RawEob["lines"],
  };
  const rebuilt = buildEob(raw, null);
  const blocking = [...typeBlocking(extracted.typeIssues, input), ...blockingFields(eobFields(rebuilt), input)];
  if (rebuilt.documentIssues.length && !input.acknowledgeTotalsMismatch) blocking.push(...rebuilt.documentIssues);
  if (blocking.length) return { ok: false, blocking: [...new Set(blocking)] };
  return {
    ok: true,
    value: Object.freeze({
      confirmed: true as const,
      documentId: input.documentId,
      insurer: rebuilt.insurer.value,
      claimNumber: rebuilt.claimNumber.value,
      provider: rebuilt.provider.value,
      patientName: rebuilt.patientName?.value ?? null,
      accountNumber: rebuilt.accountNumber?.value ?? null,
      totalPatientResponsibilityCents: rebuilt.totalPatientResponsibility.value,
      lines: rebuilt.lines.map((l) => ({
        serviceDate: l.serviceDate.value,
        code: l.code.value,
        billedCents: l.billed.value,
        allowedCents: l.allowed.value,
        planPaidCents: l.planPaid.value,
        patientResponsibilityCents: l.patientResponsibility.value,
        provenance: { page: l.patientResponsibility.page, snippet: l.patientResponsibility.snippet },
      })),
    }),
  };
}
