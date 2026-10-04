/**
 * @file Proves documents are checked for belonging to the same visit before they are compared
 * (bill vs EOB in the audit; original bill vs revised statement in verification).
 */
import { beforeEach, describe, expect, it } from "vitest";
import { billEobMismatches, revisedMismatches, sameAccount, sameName, sameProvider } from "@/lib/cases/consistency";
import { auditCase, confirmDocument, ingestSample } from "@/lib/cases/service";
import { memoryStore, type CaseStore } from "@/lib/cases/store";
import type { ConfirmedBill, ConfirmedEob } from "@/lib/types";
import { confirmedSampleBill, confirmedSampleEob } from "../helpers";

const g = globalThis as typeof globalThis & { __mhStore?: CaseStore };
const AS_PRINTED = { corrections: {}, confirmedPaths: [], acknowledgeTotalsMismatch: false };

describe("name and account matching", () => {
  /** Proves labels and punctuation don't cause false mismatches, but different entities do. */
  it("matches loosely but not across entities", () => {
    expect(sameName("Quillhaven Medical Group", "Quillhaven Medical Group (Synthetic)")).toBe(true);
    expect(sameName("Quillhaven Medical Group", "Northstar Health System")).toBe(false);
    expect(sameAccount("QMG-305518", "qmg 305518")).toBe(true);
    expect(sameAccount("QMG-305518", "QMG-305519")).toBe(false);
  });
  /** Proves the same entity printed differently is never refused (a hard block must not hit real matches). */
  it("tolerates how the same entity is printed", () => {
    expect(sameName("Priya Ramaswamy", "RAMASWAMY, PRIYA")).toBe(true);
    expect(sameName("Priya Ramaswamy", "Ms. Priya S. Ramaswamy")).toBe(true);
    expect(sameName("José Núñez", "JOSE NUNEZ")).toBe(true);
    expect(sameName("Priya Ramaswamy", "Anita Ramaswamy")).toBe(false);
    expect(sameProvider("Quillhaven Medical Group", "QUILLHAVEN MED GRP")).toBe(true);
    expect(sameProvider("Quillhaven Medical Group", "Northstar Health System")).toBe(false);
    expect(sameAccount("QMG-305518", "XXXX5518")).toBe(true);
    expect(sameAccount("QMG-305518", "305518")).toBe(true);
    expect(sameAccount("QMG-305518", "18")).toBe(false);
  });
});

describe("billEobMismatches", () => {
  /** Proves the demo bill and EOB belong together, and a different provider or date range is caught. */
  it("accepts the matching EOB and flags unrelated ones", async () => {
    const bill = await confirmedSampleBill();
    const eob = await confirmedSampleEob();
    expect(billEobMismatches(bill, eob)).toEqual([]);
    const other: ConfirmedEob = { ...eob, provider: "Northstar Health System" };
    expect(billEobMismatches(bill, other)[0]).toContain("Northstar Health System");
    const later: ConfirmedEob = { ...eob, lines: eob.lines.map((l) => ({ ...l, serviceDate: "2026-07-01" })) };
    expect(billEobMismatches(bill, later)[0]).toContain("2026-07-01");
    const otherPatient: ConfirmedEob = { ...eob, patientName: "Jordan Rivera" };
    expect(billEobMismatches(bill, otherPatient)).toEqual(["The EOB is for Jordan Rivera, but the bill is for Priya Ramaswamy."]);
  });
});

describe("revisedMismatches", () => {
  /** Proves a revised statement for another account, provider, or patient is caught. */
  it("flags a statement for a different account or patient", async () => {
    const bill = await confirmedSampleBill();
    expect(revisedMismatches(bill, { ...bill })).toEqual([]);
    const other: ConfirmedBill = { ...bill, accountNumber: "NHS-448812", patientName: "Jordan Rivera" };
    const m = revisedMismatches(bill, other);
    expect(m).toHaveLength(2);
    expect(m.join(" ")).toContain("NHS-448812");
  });
});

describe("service enforcement", () => {
  beforeEach(() => {
    g.__mhStore = memoryStore();
  });
  /** Proves the audit refuses to compare a bill with an EOB from a different provider. */
  it("refuses to audit against an unrelated EOB", async () => {
    const bill = await ingestSample(null, "sample-bill");
    const eob = await ingestSample(bill.caseId, "sample-eob");
    await confirmDocument(bill.documentId, AS_PRINTED);
    await confirmDocument(eob.documentId, { ...AS_PRINTED, corrections: { provider: "Northstar Health System" } });
    await expect(auditCase(bill.caseId, bill.documentId, eob.documentId)).rejects.toThrow(/same visit/);
    expect((await auditCase(bill.caseId, bill.documentId, null)).findings.length).toBeGreaterThan(0);
  });
  /** Proves a revised statement for a different account can't be confirmed, so it can't verify savings. */
  it("blocks confirming a revised statement for another account", async () => {
    const bill = await ingestSample(null, "sample-bill");
    await confirmDocument(bill.documentId, AS_PRINTED);
    const revised = await ingestSample(bill.caseId, "revised-statement");
    const r = await confirmDocument(revised.documentId, { ...AS_PRINTED, corrections: { "header.accountNumber": "NHS-448812" } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.blocking.join(" ")).toContain("NHS-448812");
    expect((await confirmDocument(revised.documentId, AS_PRINTED)).ok).toBe(true);
  });
});
