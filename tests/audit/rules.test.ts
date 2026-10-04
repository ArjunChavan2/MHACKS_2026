/**
 * @file Proves the deterministic audit rules and verdict on the demo case (SPEC.md §4.3, §4.4).
 */
import { describe, expect, it } from "vitest";
import { computeVerdict, runAudit } from "@/lib/audit";
import { findBillExceedsEob, findDocumentationGaps, findDuplicateCharges } from "@/lib/audit/rules";
import { getRecords, providersOf } from "@/lib/finchnode";
import type { ConfirmedBill } from "@/lib/types";
import { confirmedSampleBill, confirmedSampleEob } from "../helpers";

describe("duplicate charges", () => {
  /** Proves lines 4 and 7 (same code, date, amount) form one potential duplicate questioning line 7. */
  it("finds the 80053 duplicate", async () => {
    const [f, ...rest] = findDuplicateCharges(await confirmedSampleBill());
    expect(rest).toHaveLength(0);
    expect(f.status).toBe("potential");
    expect(f.lineNumbers).toEqual([7]);
    expect(f.amountQuestionedCents).toBe(14200);
    expect(f.sources.map((s) => (s.kind === "bill_line" ? s.lineNumber : null))).toEqual([4, 7]);
    expect(f.title).not.toMatch(/error/i);
  });
  /** Proves a different quantity is not treated as a duplicate. */
  it("ignores lines with different quantities", async () => {
    const bill = await confirmedSampleBill();
    const changed: ConfirmedBill = { ...bill, lines: bill.lines.map((l) => (l.lineNumber === 7 ? { ...l, quantity: 2 } : l)) };
    expect(findDuplicateCharges(changed)).toHaveLength(0);
  });
});

describe("bill exceeds EOB", () => {
  /** Proves the $142 gap to the EOB is found and attributed to line 7, which the EOB lacks. */
  it("finds the difference and the unmatched line", async () => {
    const [f] = findBillExceedsEob(await confirmedSampleBill(), await confirmedSampleEob());
    expect(f.amountQuestionedCents).toBe(14200);
    expect(f.lineNumbers).toEqual([7]);
  });
  /** Proves no finding without an EOB. */
  it("does nothing without an EOB", async () => {
    expect(findBillExceedsEob(await confirmedSampleBill(), null)).toEqual([]);
  });
});

describe("documentation gaps", () => {
  /** Proves only the troponin (no matching record) is flagged, worded as a documentation request. */
  it("flags line 8 only", async () => {
    const records = getRecords();
    const gaps = findDocumentationGaps(await confirmedSampleBill(), records, providersOf(records));
    expect(gaps.map((g) => g.lineNumbers)).toEqual([[8]]);
    expect(gaps[0].ask).toContain("documentation");
    expect(gaps[0].explanation).toContain("doesn't prove");
    expect(gaps[0].sources[1].kind).toBe("records_searched");
  });
  /** Proves a record dated outside the ±1 day window does not count as a match. */
  it("respects the date window", async () => {
    const records = getRecords().map((r) => (r.recordId === "ns-lab-0914-cbc" ? { ...r, recordedAt: "2026-09-20" } : r));
    const gaps = findDocumentationGaps(await confirmedSampleBill(), records, providersOf(records));
    expect(gaps.flatMap((g) => g.lineNumbers).sort()).toEqual([3, 8]);
  });
});

describe("runAudit and verdict", () => {
  /** Proves the verdict counts line 7 once even though two findings question it: $142 + $112. */
  it("computes the questioned total without double counting", async () => {
    const records = getRecords();
    const { findings, verdict } = runAudit(await confirmedSampleBill(), await confirmedSampleEob(), records, providersOf(records));
    expect(findings.map((f) => f.rule)).toEqual(["duplicate_charge", "bill_exceeds_eob", "documentation_gap"]);
    expect(verdict).toEqual({ totalBilledCents: 172400, questionedCents: 25400, offeredCents: null, confirmedCents: null });
  });
  /** Proves the audit is deterministic. */
  it("returns identical results on repeated runs", async () => {
    const bill = await confirmedSampleBill();
    const eob = await confirmedSampleEob();
    const records = getRecords();
    expect(runAudit(bill, eob, records, ["A"])).toEqual(runAudit(bill, eob, records, ["A"]));
  });
  /** Proves withdrawn findings don't count toward the questioned amount. */
  it("ignores withdrawn findings in the verdict", async () => {
    const bill = await confirmedSampleBill();
    const [dup] = findDuplicateCharges(bill);
    expect(computeVerdict(bill, [{ ...dup, status: "withdrawn" }]).questionedCents).toBe(0);
  });
});
