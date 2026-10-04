/**
 * @file Converts a raw model reply into a normalized, checked extraction (SPEC.md §4.2 steps 2, 5–6).
 *
 * Used by the live pipeline and by the no-AI path (saved fixture replies), so both go through the
 * exact same normalization and checks.
 */
import type { BillLine, ExtractedBill, ExtractedEob, EobLine } from "@/lib/types";
import { checkBill, checkEob } from "./checks";
import { billTypeIssues, eobTypeIssues } from "./doctype";
import {
  inferCodeType,
  parseCodeType,
  parseDate,
  parseInteger,
  parseMoney,
  parseProviderType,
  parseText,
  toField,
} from "./normalize";
import type { RawBill, RawEob } from "./schemas";
import type { TextLayer } from "./textLayer";

/**
 * Normalizes and checks a raw bill reply.
 *
 * Pure apart from building new objects.
 *
 * @param raw - Validated raw bill reply.
 * @param layer - Per-page PDF text for the cross-check, or `null` for photos and scans.
 * @returns The extracted bill with verification set on every field.
 */
export function buildBill(raw: RawBill, layer: TextLayer): ExtractedBill {
  const h = raw.header;
  const bill: ExtractedBill = {
    docType: raw.docType,
    header: {
      // The entity is the organization's name; models sometimes include the address block below it.
      billingEntity: toField(h.billingEntity, (s) => parseText(s.split(/\r?\n/).find((l) => l.trim()) ?? s), "Billing entity"),
      providerType: toField(h.providerType, parseProviderType, "Provider type"),
      accountNumber: toField(h.accountNumber, parseText, "Account number"),
      patientName: toField(h.patientName, parseText, "Patient name"),
      serviceStart: toField(h.serviceStart, parseDate, "Service start date"),
      serviceEnd: toField(h.serviceEnd, parseDate, "Service end date"),
      encounter: toField(h.encounter, parseText, "Encounter"),
      statementDate: toField(h.statementDate, parseDate, "Statement date"),
      totalCharges: toField(h.totalCharges, parseMoney, "Total charges"),
      totalAdjustments: toField(h.totalAdjustments, parseMoney, "Total adjustments"),
      totalPayments: toField(h.totalPayments, parseMoney, "Total payments"),
      amountDue: toField(h.amountDue, parseMoney, "Amount due"),
    },
    lines: raw.lines.map((l, i): BillLine => {
      const n = `Line ${l.lineNumber.raw ?? i + 1}`;
      const code = toField(l.code, (s) => parseText(s)?.toUpperCase() ?? null, `${n} code`);
      const codeType = toField(l.codeType, parseCodeType, `${n} code type`);
      // Bills rarely print the code type; infer it from the code's format when no label was given.
      if (codeType.value === null && !codeType.issues.length && code.value) codeType.value = inferCodeType(code.value);
      return {
        lineNumber: toField(l.lineNumber, parseInteger, `${n} number`),
        serviceDate: toField(l.serviceDate, parseDate, `${n} service date`),
        code,
        codeType,
        description: toField(l.description, parseText, `${n} description`),
        quantity: toField(l.quantity, parseInteger, `${n} quantity`),
        unitPrice: toField(l.unitPrice, parseMoney, `${n} unit price`),
        charge: toField(l.charge, parseMoney, `${n} charge`),
        adjustment: toField(l.adjustment, parseMoney, `${n} adjustment`),
        patientResponsibility: toField(l.patientResponsibility, parseMoney, `${n} patient responsibility`),
      };
    }),
    documentIssues: [],
  };
  checkBill(bill, layer);
  bill.typeIssues = billTypeIssues(bill, layer);
  return bill;
}

/**
 * Normalizes and checks a raw EOB reply.
 *
 * @param raw - Validated raw EOB reply.
 * @param layer - Per-page PDF text, or `null`.
 * @returns The extracted EOB with verification set on every field.
 */
export function buildEob(raw: RawEob, layer: TextLayer): ExtractedEob {
  const eob: ExtractedEob = {
    docType: "eob",
    insurer: toField(raw.insurer, parseText, "Insurer"),
    claimNumber: toField(raw.claimNumber, parseText, "Claim number"),
    provider: toField(raw.provider, parseText, "Provider"),
    patientName: toField(raw.patientName, parseText, "Patient name"),
    accountNumber: toField(raw.accountNumber, parseText, "Account number"),
    totalPatientResponsibility: toField(raw.totalPatientResponsibility, parseMoney, "Total you owe"),
    lines: raw.lines.map((l, i): EobLine => ({
      serviceDate: toField(l.serviceDate, parseDate, `EOB line ${i + 1} service date`),
      code: toField(l.code, (s) => parseText(s)?.toUpperCase() ?? null, `EOB line ${i + 1} code`),
      billed: toField(l.billed, parseMoney, `EOB line ${i + 1} billed`),
      allowed: toField(l.allowed, parseMoney, `EOB line ${i + 1} allowed`),
      planPaid: toField(l.planPaid, parseMoney, `EOB line ${i + 1} plan paid`),
      patientResponsibility: toField(l.patientResponsibility, parseMoney, `EOB line ${i + 1} you owe`),
    })),
    documentIssues: [],
  };
  checkEob(eob, layer);
  eob.typeIssues = eobTypeIssues(eob, layer);
  return eob;
}
