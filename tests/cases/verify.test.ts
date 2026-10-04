/**
 * @file Proves revised-statement verification (SPEC.md §4.6): lines are matched by code and date,
 * savings are the drop in amount due (never negative), and only fully removed lines resolve a finding.
 */
import { describe, expect, it } from "vitest";
import { runAudit } from "@/lib/audit";
import { compareRevised } from "@/lib/cases/verify";
import { getRecords, providersOf } from "@/lib/finchnode";
import type { ConfirmedBill, Finding } from "@/lib/types";
import { confirmedSampleBill, confirmedSampleEob } from "../helpers";

/** The demo bill and findings, with the duplicate marked confirmed by the office. */
async function demo(): Promise<{ bill: ConfirmedBill; findings: Finding[] }> {
  const bill = await confirmedSampleBill();
  const records = getRecords();
  const { findings } = runAudit(bill, await confirmedSampleEob(), records, providersOf(records));
  return { bill, findings: findings.map((f) => (f.rule === "duplicate_charge" ? { ...f, status: "confirmed" as const } : f)) };
}

/**
 * A revised statement built from the original.
 *
 * @param bill - Original.
 * @param keep - Line numbers to keep.
 * @param dueCents - New amount due.
 * @param edit - Optional per-line change.
 * @returns A confirmed revised statement, renumbered from 1 like a real reprint.
 */
function revised(bill: ConfirmedBill, keep: number[], dueCents: number | null, edit?: (l: ConfirmedBill["lines"][number]) => ConfirmedBill["lines"][number]): ConfirmedBill {
  const lines = bill.lines.filter((l) => keep.includes(l.lineNumber)).map((l, i) => ({ ...(edit ? edit(l) : l), lineNumber: i + 1 }));
  return { ...bill, documentId: "doc_revised", lines, amountDueCents: dueCents };
}

describe("compareRevised", () => {
  /** Proves removing the second TSH resolves the duplicate and over-EOB findings and confirms $68. */
  it("detects the removed duplicate even though lines are renumbered", async () => {
    const { bill, findings } = await demo();
    const cmp = compareRevised(bill, revised(bill, [1, 2, 3, 4], 25300), findings);
    expect(cmp.removedLines).toEqual([5]);
    expect(cmp.newLines).toEqual([]);
    expect(cmp.confirmedSavingsCents).toBe(6800);
    const rules = findings.filter((f) => cmp.resolvedFindingIds.includes(f.id)).map((f) => f.rule).sort();
    expect(rules).toEqual(["bill_exceeds_eob", "duplicate_charge"]);
  });
  /** Proves an unchanged statement verifies nothing and flags the confirmed finding as not reflected. */
  it("verifies nothing when the bill is unchanged", async () => {
    const { bill, findings } = await demo();
    const cmp = compareRevised(bill, revised(bill, [1, 2, 3, 4, 5], 32100), findings);
    expect(cmp.confirmedSavingsCents).toBe(0);
    expect(cmp.resolvedFindingIds).toEqual([]);
    expect(cmp.notReflectedFindingIds).toEqual([findings.find((f) => f.rule === "duplicate_charge")?.id]);
  });
  /** Proves a reduced (not removed) charge is reported but does not resolve a finding; zeroed does. */
  it("reports reductions and treats $0 as removed", async () => {
    const { bill, findings } = await demo();
    const reduced = compareRevised(bill, revised(bill, [1, 2, 3, 4, 5], 29100, (l) => (l.lineNumber === 5 ? { ...l, chargeCents: 3800 } : l)), findings);
    expect(reduced.reducedLines).toEqual([[5, 6800, 3800]]);
    expect(reduced.resolvedFindingIds).toEqual([]);
    const zeroed = compareRevised(bill, revised(bill, [1, 2, 3, 4, 5], 25300, (l) => (l.lineNumber === 5 ? { ...l, chargeCents: 0 } : l)), findings);
    expect(zeroed.resolvedFindingIds.length).toBe(2);
  });
  /** Proves a higher total or added charge never counts as savings. */
  it("never claims savings from a higher bill and flags new lines", async () => {
    const { bill, findings } = await demo();
    const extra = { ...bill.lines[1], code: "82728", description: "Ferritin", chargeCents: 4700 };
    const higher: ConfirmedBill = { ...bill, documentId: "doc_revised", lines: [...bill.lines.map((l) => ({ ...l })), { ...extra, lineNumber: 6 }], amountDueCents: 36800 };
    const cmp = compareRevised(bill, higher, findings);
    expect(cmp.confirmedSavingsCents).toBe(0);
    expect(cmp.newLines).toEqual([6]);
    expect(compareRevised(bill, revised(bill, [1, 2, 3, 4], null), findings).confirmedSavingsCents).toBe(0);
  });
});
