/**
 * @file Proves confirmation is the gate before the audit: flagged fields and broken totals block it
 * until corrected, confirmed, or acknowledged (SPEC.md §4.2 steps 7–8).
 */
import { describe, expect, it } from "vitest";
import { confirmBill } from "@/lib/extract/confirm";
import { extractedBill } from "../helpers";

const base = { documentId: "doc_1", corrections: {}, confirmedPaths: [], acknowledgeTotalsMismatch: false };

describe("confirmBill", () => {
  /** Proves a clean bill confirms and is frozen (locked). */
  it("confirms a clean bill and locks it", async () => {
    const r = confirmBill(await extractedBill("sample-bill"), base);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.lines).toHaveLength(5);
      expect(Object.isFrozen(r.value)).toBe(true);
    }
  });
  /** Proves broken totals block the audit until resolved. */
  it("blocks broken totals", async () => {
    const r = confirmBill(await extractedBill("bill-broken-totals"), base);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.blocking.join(" ")).toContain("add up to");
  });
  /** Proves correcting a misread total unblocks confirmation. */
  it("unblocks when the patient corrects the total", async () => {
    const r = confirmBill(await extractedBill("bill-broken-totals"), { ...base, corrections: { "header.totalCharges": "$453.00" } });
    expect(r.ok).toBe(true);
  });
  /** Proves acknowledging that the printed bill itself doesn't add up unblocks and is recorded. */
  it("unblocks when the patient acknowledges printed totals don't add up", async () => {
    const r = confirmBill(await extractedBill("bill-broken-totals"), { ...base, acknowledgeTotalsMismatch: true });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.totalsMismatchAcknowledged).toBe(true);
  });
  /** Proves a balance statement can never be confirmed for an audit (no line items). */
  it("blocks a balance statement", async () => {
    const r = confirmBill(await extractedBill("balance-statement"), base);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.blocking.join(" ")).toContain("Request the itemized bill");
  });
  /** Proves an unparseable correction stays blocked instead of being accepted. */
  it("keeps blocking an invalid correction", async () => {
    const r = confirmBill(await extractedBill("sample-bill"), { ...base, corrections: { "lines.3.charge": "one forty two" } });
    expect(r.ok).toBe(false);
  });
});
