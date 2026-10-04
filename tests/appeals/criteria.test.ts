/**
 * @file Proves the denial criteria engine (SPEC.md §4.10, MVP 5) on the demo denial and Priya's
 * FinchNode records: every criterion met with evidence from both providers, and the missing,
 * unconfirmed, and unknown-policy paths. Evidence must be the records themselves.
 */
import { describe, expect, it } from "vitest";
import { evaluateDenial } from "@/lib/appeals/criteria";
import { confirmDenial, buildDenial, type RawDenial } from "@/lib/extract/denial";
import { getRecords } from "@/lib/finchnode";
import type { ConfirmedDenial } from "@/lib/types";
import { fixtureReply } from "../helpers";

/** The demo denial, confirmed as printed. */
function demoDenial(): ConfirmedDenial {
  const extracted = buildDenial(fixtureReply("denial-letter") as RawDenial, null);
  const r = confirmDenial(extracted, { documentId: "doc_denial", corrections: {}, confirmedPaths: [], acknowledgeTotalsMismatch: false });
  if (!r.ok) throw new Error(r.blocking.join("; "));
  return r.value;
}

describe("evaluateDenial", () => {
  /** Proves all three criteria are met and each cites records from Northstar and Quillhaven. */
  it("meets every criterion with records from both providers", () => {
    const e = evaluateDenial(demoDenial(), getRecords());
    expect(e.policyKnown).toBe(true);
    expect(e.allMet).toBe(true);
    expect(e.criteria.map((c) => [c.id, c.status])).toEqual([["diagnosis", "met"], ["treatment", "met"], ["recent_test", "met"]]);
    for (const c of e.criteria) {
      const providers = new Set(c.evidence.map((r) => r.provider.split(" ")[0]));
      expect(providers).toEqual(new Set(["Northstar", "Quillhaven"]));
    }
    const tests = e.criteria.find((c) => c.id === "recent_test")?.evidence ?? [];
    expect(tests.map((r) => r.code).sort()).toEqual(["3016-3", "3016-3", "3024-7"]);
    expect(Object.isFrozen(tests[0])).toBe(true);
  });
  /** Proves a criterion with no qualifying record is missing (and what's needed is said), so no appeal. */
  it("marks a criterion missing when no record qualifies", () => {
    const late = { ...demoDenial(), letterDate: "2026-09-01" };
    const e = evaluateDenial(late, getRecords());
    const test = e.criteria.find((c) => c.id === "recent_test");
    expect(test?.status).toBe("missing");
    expect(test?.needed).toContain("60 days");
    expect(e.allMet).toBe(false);
  });
  /** Proves a matching medication without a recorded status is unconfirmed, never met. */
  it("treats a medication without status as unconfirmed", () => {
    const records = getRecords().map((r) => (r.category === "medication" ? { ...r, status: null } : r));
    expect(evaluateDenial(demoDenial(), records).criteria.find((c) => c.id === "treatment")?.status).toBe("unconfirmed");
  });
  /** Proves an unknown policy is never guessed at. */
  it("refuses to evaluate an unknown policy", () => {
    const e = evaluateDenial({ ...demoDenial(), policyId: "XYZ-999" }, getRecords());
    expect(e).toMatchObject({ policyKnown: false, criteria: [], allMet: false });
  });
});
