/**
 * @file Proves insurer denials (EOB pays $0, patient owes the full billed amount) become findings for
 * the insurer, aren't put in the billing-office letter, and route the next step to the insurer.
 */
import { describe, expect, it } from "vitest";
import { findInsurerDenials } from "@/lib/audit/rules";
import { recommendAction, allowedActions, type CaseSnapshot } from "@/lib/cases/machine";
import type { ConfirmedEob } from "@/lib/types";
import { confirmedSampleBill, confirmedSampleEob } from "../helpers";

describe("findInsurerDenials", () => {
  /** Proves a $0-allowed, $0-paid, full-patient-responsibility line is flagged for the insurer, and normal lines aren't. */
  it("flags fully denied lines only", async () => {
    const bill = await confirmedSampleBill();
    const eob = await confirmedSampleEob();
    expect(findInsurerDenials(bill, eob)).toEqual([]);
    const denied: ConfirmedEob = { ...eob, lines: eob.lines.map((l, i) => (i === 3 ? { ...l, allowedCents: 0, planPaidCents: 0, patientResponsibilityCents: l.billedCents } : l)) };
    const [f, ...rest] = findInsurerDenials(bill, denied);
    expect(rest).toHaveLength(0);
    expect(f).toMatchObject({ rule: "insurer_denied_line", contact: "insurer", lineNumbers: [4], amountQuestionedCents: 5400 });
    expect(f.ask).toContain("Wolverine Mutual Health");
  });
  /** Proves the card sends insurer-only cases to the insurer and offers no billing dispute. */
  it("routes insurer-only cases to the insurer", async () => {
    const bill = await confirmedSampleBill();
    const eob = await confirmedSampleEob();
    const denied: ConfirmedEob = { ...eob, lines: eob.lines.map((l, i) => (i === 3 ? { ...l, allowedCents: 0, planPaidCents: 0, patientResponsibilityCents: l.billedCents } : l)) };
    const s: CaseSnapshot = { hasConfirmedBill: true, audited: true, findings: findInsurerDenials(bill, denied), tasks: [], dispute: null, responsesRecorded: 0, revisedAwaitingConfirmation: null, approvals: [], billingEntity: "Quillhaven Medical Group" } as CaseSnapshot;
    expect(recommendAction(s, "2026-03-25")).toMatchObject({ title: "Call your insurer about the unpaid charge", responsibleParty: "Your insurer" });
    expect(allowedActions(s, "2026-03-25").some((a) => a.id === "draft_dispute")).toBe(false);
  });
});
