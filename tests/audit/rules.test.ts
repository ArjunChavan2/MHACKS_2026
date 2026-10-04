/**
 * @file Proves the deterministic audit rules and verdict on the demo case (SPEC.md §4.3, §4.4).
 */
import { describe, expect, it } from "vitest";
import { computeVerdict, runAudit } from "@/lib/audit";
import { findBillExceedsEob, findDocumentationGaps, findDuplicateCharges, findServicesWithoutRecord } from "@/lib/audit/rules";
import { getRecords, providersOf } from "@/lib/finchnode";
import type { ConfirmedBill } from "@/lib/types";
import { confirmedSampleBill, confirmedSampleEob } from "../helpers";

describe("duplicate charges", () => {
  /** Proves lines 3 and 5 (same code, date, amount) form one potential duplicate questioning line 5. */
  it("finds the 84443 duplicate", async () => {
    const [f, ...rest] = findDuplicateCharges(await confirmedSampleBill());
    expect(rest).toHaveLength(0);
    expect(f.status).toBe("potential");
    expect(f.lineNumbers).toEqual([5]);
    expect(f.amountQuestionedCents).toBe(6800);
    expect(f.sources.map((s) => (s.kind === "bill_line" ? s.lineNumber : null))).toEqual([3, 5]);
    expect(f.title).not.toMatch(/error/i);
  });
  /** Proves a different quantity is not treated as a duplicate. */
  it("ignores lines with different quantities", async () => {
    const bill = await confirmedSampleBill();
    const changed: ConfirmedBill = { ...bill, lines: bill.lines.map((l) => (l.lineNumber === 5 ? { ...l, quantity: 2 } : l)) };
    expect(findDuplicateCharges(changed)).toHaveLength(0);
  });
});

describe("bill exceeds EOB", () => {
  /** Proves the $68 gap to the EOB is found and attributed to line 5, which the EOB lacks. */
  it("finds the difference and the unmatched line", async () => {
    const [f] = findBillExceedsEob(await confirmedSampleBill(), await confirmedSampleEob());
    expect(f.amountQuestionedCents).toBe(6800);
    expect(f.lineNumbers).toEqual([5]);
  });
  /** Proves no finding without an EOB. */
  it("does nothing without an EOB", async () => {
    expect(findBillExceedsEob(await confirmedSampleBill(), null)).toEqual([]);
  });
});

describe("documentation gaps", () => {
  /**
   * Proves only the free T4 (line 4) is flagged: Quillhaven's records show a TSH that day but no free
   * T4. The closest free T4 (Northstar, 3 days earlier) is cited verbatim as cross-provider evidence.
   */
  it("flags line 4 only and cites the closest record from the other provider", async () => {
    const records = getRecords();
    const gaps = findDocumentationGaps(await confirmedSampleBill(), records, providersOf(records));
    expect(gaps.map((g) => g.lineNumbers)).toEqual([[4]]);
    expect(gaps[0].ask).toContain("documentation");
    expect(gaps[0].explanation).toContain("doesn't prove");
    expect(gaps[0].explanation).toContain("Northstar Health System (Synthetic) on March 2, 2026, 3 days before");
    expect(gaps[0].sources[1].kind).toBe("records_searched");
    const cited = gaps[0].sources[2];
    expect(cited.kind === "record" && cited.fact.code).toBe("3024-7");
  });
  /** Proves a record dated outside the ±1 day window does not count as a match. */
  it("respects the date window", async () => {
    const moved = (r: ReturnType<typeof getRecords>[number]) =>
      r.provider.startsWith("Quillhaven") && r.code === "3016-3" ? { ...r, recordedAt: "2026-03-10" } : r;
    const records = getRecords().map(moved);
    const gaps = findDocumentationGaps(await confirmedSampleBill(), records, providersOf(records));
    expect(gaps.flatMap((g) => g.lineNumbers).sort()).toEqual([3, 4, 5]);
  });
});

describe("runAudit and verdict", () => {
  /** Proves the verdict counts line 5 once even though two findings question it: $68 + $54. */
  it("computes the questioned total without double counting", async () => {
    const records = getRecords();
    const { findings, verdict } = runAudit(await confirmedSampleBill(), await confirmedSampleEob(), records, providersOf(records));
    expect(findings.map((f) => f.rule)).toEqual(["duplicate_charge", "bill_exceeds_eob", "documentation_gap"]);
    expect(verdict).toEqual({ totalBilledCents: 45300, questionedCents: 12200, offeredCents: null, confirmedCents: null });
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

describe("findServicesWithoutRecord", () => {
  /** Proves the demo bill's visit and blood draw are supported by the provider's visit and lab records. */
  it("accepts a visit and draw the records support", async () => {
    const bill = await confirmedSampleBill();
    expect(findServicesWithoutRecord(bill, getRecords())).toEqual([]);
  });
  /** Proves a procedure is flagged, quoting the only visit recorded that day, with the record cited. */
  it("flags a procedure the records don't mention", async () => {
    const bill = await confirmedSampleBill();
    const last = bill.lines.at(-1)!;
    const amputation = { ...bill, lines: [...bill.lines, { ...last, lineNumber: 6, code: "27880", description: "Amputation, leg, through tibia and fibula", chargeCents: 1840000, patientResponsibilityCents: null }] };
    const [f, ...rest] = findServicesWithoutRecord(amputation, getRecords());
    expect(rest).toEqual([]);
    expect(f).toMatchObject({ rule: "service_without_record", lineNumbers: [6], amountQuestionedCents: 1840000 });
    expect(f.explanation).toContain('"Endocrinology consult" (March 5, 2026)');
    expect(f.letterText).toMatch(/operative or procedure report/);
    expect(f.sources.some((s) => s.kind === "record" && s.fact.text === "Endocrinology consult")).toBe(true);
  });
  /** Proves a visit with no visit on record that day is flagged, and nothing is checked without the provider's records. */
  it("flags a visit with no visit record, and skips unconnected providers", async () => {
    const bill = await confirmedSampleBill();
    const moved = { ...bill, lines: bill.lines.map((l) => (l.code === "99214" ? { ...l, serviceDate: "2026-02-10" } : l)) };
    const found = findServicesWithoutRecord(moved, getRecords());
    expect(found.map((f) => f.id)).toEqual(["norecord-1-99214"]);
    expect(findServicesWithoutRecord({ ...moved, billingEntity: "Some Other Clinic" }, getRecords())).toEqual([]);
  });
});
