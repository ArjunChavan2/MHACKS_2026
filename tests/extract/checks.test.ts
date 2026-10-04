/**
 * @file Proves the deterministic checks and text-layer cross-check flag the right fields
 * (SPEC.md §4.2 steps 4–6).
 */
import { describe, expect, it } from "vitest";
import { buildBill } from "@/lib/extract/build";
import { billFields, codeFormatIssue, needsAttention } from "@/lib/extract/checks";
import type { RawBill } from "@/lib/extract/schemas";
import { readTextLayer } from "@/lib/extract/textLayer";
import { extractedBill, extractedEob, fixturePdf, fixtureReply } from "../helpers";

describe("sample documents", () => {
  /** Proves a clean, correctly read bill verifies every printed field (no false alarms). */
  it("verifies every field of the clean sample bill", async () => {
    const bill = await extractedBill("sample-bill");
    expect(needsAttention(billFields(bill))).toEqual([]);
    expect(bill.documentIssues).toEqual([]);
    expect(bill.header.amountDue.value).toBe(32100);
  });
  /** Proves the EOB lines reconcile with its total. */
  it("verifies the sample EOB", async () => {
    const eob = await extractedEob();
    expect(eob.documentIssues).toEqual([]);
    expect(eob.totalPatientResponsibility.value).toBe(25300);
  });
  /** Proves broken totals flag the total and add a document issue (which later blocks the audit). */
  it("flags broken totals", async () => {
    const bill = await extractedBill("bill-broken-totals");
    expect(bill.header.totalCharges.verification).toBe("needs_attention");
    expect(bill.documentIssues.join(" ")).toContain("add up to $453.00");
  });
});

describe("text-layer cross-check", () => {
  /** Proves a value the model claims but the PDF doesn't contain gets flagged (hallucination guard). */
  it("flags a value that does not appear in the PDF text", async () => {
    const raw = structuredClone(fixtureReply("sample-bill")) as RawBill;
    raw.lines[3].charge.raw = "$412.00";
    const bill = buildBill(raw, await readTextLayer(fixturePdf("sample-bill")));
    expect(bill.lines[3].charge.verification).toBe("needs_attention");
    expect(bill.lines[3].charge.issues.join(" ")).toContain("does not appear on page 1");
  });
  /** Proves photos and scans (no text layer) skip the cross-check rather than failing everything. */
  it("skips the cross-check when there is no text layer", () => {
    const bill = buildBill(fixtureReply("sample-bill") as RawBill, null);
    expect(needsAttention(billFields(bill))).toEqual([]);
  });
});

describe("field checks", () => {
  /** Proves code formats are checked by pattern only. */
  it("checks code formats", () => {
    expect(codeFormatIssue("80053", "CPT")).toBeNull();
    expect(codeFormatIssue("J1885", "HCPCS")).toBeNull();
    expect(codeFormatIssue("8005", "CPT")).toContain("does not look like");
    expect(codeFormatIssue("0450", "REV")).toBeNull();
  });
  /** Proves quantity × unit price must equal the charge when both are printed. */
  it("flags quantity times unit price mismatches", () => {
    const raw = structuredClone(fixtureReply("sample-bill")) as RawBill;
    raw.lines[1].quantity.raw = "2";
    raw.lines[1].unitPrice = { raw: "$18.00", page: 1, snippet: null, status: "read" };
    const bill = buildBill(raw, null);
    expect(bill.lines[1].charge.issues.join(" ")).toContain("does not equal the charge");
  });
  /** Proves repeated line numbers and out-of-range dates are flagged. */
  it("flags duplicate line numbers and dates outside the service range", () => {
    const raw = structuredClone(fixtureReply("sample-bill")) as RawBill;
    raw.lines[2].lineNumber.raw = "1";
    raw.lines[4].serviceDate.raw = "09/20/2026";
    const bill = buildBill(raw, null);
    expect(bill.lines[2].lineNumber.verification).toBe("needs_attention");
    expect(bill.lines[4].serviceDate.issues.join(" ")).toContain("outside");
  });
});
