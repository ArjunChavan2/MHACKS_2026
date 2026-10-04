/**
 * @file Proves the adaptive case core (SPEC.md §3.5, §3.6, §4.6, §6 MVP 2 exit criteria) on the
 * demo case: each branch changes the plan correctly, nothing runs without approval, waiting and
 * resuming work, statuses survive audit reruns, and savings are confirmed only with a revised statement.
 */
import { describe, expect, it } from "vitest";
import { runAudit } from "@/lib/audit";
import { getRecords, providersOf } from "@/lib/finchnode";
import { allowedActions, canRun, derivePhase, recommendAction, type CaseSnapshot } from "@/lib/cases/machine";
import { CaseRuleError, REVISED_STATEMENT, applyResponse, applyVerification, computeSavings, mergeFindings } from "@/lib/cases/responses";
import { compareRevised } from "@/lib/cases/verify";
import type { CaseTask, ConfirmedBill, CounterpartyResponse, Finding } from "@/lib/types";
import { confirmedSampleBill, confirmedSampleEob } from "../helpers";

const TODAY = "2026-03-25";
const OFFICE = "Quillhaven Medical Group billing office";

/** Builds the demo bill and its audit findings. */
async function demo(): Promise<{ bill: ConfirmedBill; findings: Finding[] }> {
  const bill = await confirmedSampleBill();
  const records = getRecords();
  return { bill, findings: runAudit(bill, await confirmedSampleEob(), records, providersOf(records)).findings };
}

/** IDs of the three demo findings by rule. */
function ids(findings: Finding[]) {
  const by = (rule: Finding["rule"]) => findings.find((f) => f.rule === rule)?.id as string;
  return { dup: by("duplicate_charge"), eob: by("bill_exceeds_eob"), gap: by("documentation_gap") };
}

/** A snapshot after the dispute was sent, with the given findings and tasks. */
function sent(findings: Finding[], tasks: CaseTask[] = [], extra: Partial<CaseSnapshot> = {}): CaseSnapshot {
  return {
    hasConfirmedBill: true,
    audited: true,
    findings,
    tasks,
    dispute: { documentId: "doc_letter", sent: true, sentAt: "2026-03-21" },
    responsesRecorded: 1,
    revisedAwaitingConfirmation: null,
    approvals: [{ action: "send_dispute", target: "doc_letter" }],
    billingEntity: "Quillhaven Medical Group",
    ...extra,
  };
}

let n = 0;
const ctx = { eventId: "evt_1", receivedAt: "2026-03-24", newTaskId: () => `task_${++n}` };

/** The revised statement: the original without line 5, amount due $253.00. */
function revisedOf(bill: ConfirmedBill): ConfirmedBill {
  return {
    ...bill,
    documentId: "doc_revised",
    lines: bill.lines.filter((l) => l.lineNumber !== 5).map((l) => ({ ...l })),
    totalChargesCents: 38500,
    amountDueCents: 25300,
  };
}

describe("approval gate", () => {
  /** Proves the drafted dispute can't be sent until the patient approves it. */
  it("refuses to send the dispute without approval", async () => {
    const { findings } = await demo();
    const s: CaseSnapshot = { ...sent(findings), dispute: { documentId: "doc_letter", sent: false }, responsesRecorded: 0, approvals: [] };
    expect(derivePhase(s)).toBe("awaiting_approval");
    expect(recommendAction(s, TODAY)).toMatchObject({ actionId: "send_dispute", needsApproval: true });
    expect(canRun(s, "send_dispute", TODAY, "doc_letter")).toEqual({ ok: false, reason: '"Send the dispute letter" needs your approval first.' });
    const approved = { ...s, approvals: [{ action: "send_dispute" as const, target: "doc_letter" }] };
    expect(canRun(approved, "send_dispute", TODAY, "doc_letter")).toEqual({ ok: true });
    expect(canRun(approved, "follow_up", TODAY).ok).toBe(false);
  });
});

describe("branch: evidence confirms the error", () => {
  /** Proves offered savings appear on confirmation, and become confirmed only with a revised statement. */
  it("confirms, waits for the revised statement, then verifies $68", async () => {
    const { bill, findings } = await demo();
    const { dup, eob } = ids(findings);
    const response: CounterpartyResponse = { from: OFFICE, perFinding: [{ findingId: dup, kind: "confirms_error" }, { findingId: eob, kind: "confirms_error" }], note: "Line 5 was entered twice." };
    const r = applyResponse(findings, [], response, ctx);
    expect(r.findings.find((f) => f.id === dup)).toMatchObject({ status: "confirmed", verified: false });
    expect(r.findings.find((f) => f.id === dup)?.statusSources?.[0]).toMatchObject({ kind: "response", note: "Line 5 was entered twice." });
    expect(r.tasks).toEqual([expect.objectContaining({ kind: "await_document", documentNeeded: REVISED_STATEMENT, status: "open" })]);
    expect(computeSavings(bill, r.findings, null)).toEqual({ questionedCents: 12200, offeredCents: 6800, confirmedCents: null });

    const waiting = sent(r.findings, r.tasks);
    expect(derivePhase(waiting)).toBe("waiting_document");
    expect(recommendAction(waiting, TODAY)).toMatchObject({ actionId: "wait", deadline: "unconfirmed" });

    const cmp = compareRevised(bill, revisedOf(bill), r.findings);
    const v = applyVerification(r.findings, r.tasks, cmp, { documentId: "doc_revised", receivedAt: "2026-04-02" });
    expect(v.findings.find((f) => f.id === dup)).toMatchObject({ status: "confirmed", verified: true });
    expect(v.tasks[0].status).toBe("done");
    // Settled lines leave "still in question"; only the free T4 ($54) stays open.
    expect(computeSavings(bill, v.findings, cmp)).toEqual({ questionedCents: 5400, offeredCents: 0, confirmedCents: 6800 });
    // The free T4 gap is still open, so the case is not resolved.
    expect(derivePhase(sent(v.findings, v.tasks))).toBe("waiting_response");
  });
});

describe("branch: evidence disproves the concern", () => {
  /** Proves the free T4 concern is withdrawn with the cited document and no savings are claimed for it. */
  it("withdraws the documentation gap and continues with the rest", async () => {
    const { bill, findings } = await demo();
    const { gap } = ids(findings);
    const response: CounterpartyResponse = { from: OFFICE, perFinding: [{ findingId: gap, kind: "provides_documentation" }], documentId: "doc_lab", documentLabel: "Lab result: free T4, collected 03/05/2026" };
    const r = applyResponse(findings, [], response, ctx);
    const f = r.findings.find((x) => x.id === gap) as Finding;
    expect(f.status).toBe("withdrawn");
    expect(f.statusNote).toContain("no savings are claimed");
    expect(f.statusSources?.[1]).toMatchObject({ kind: "document", documentId: "doc_lab" });
    expect(computeSavings(bill, r.findings, null).questionedCents).toBe(6800);
    expect(() => applyResponse(r.findings, [], response, ctx)).toThrow(CaseRuleError);
  });
  /** Proves a documentation response without a document is refused. */
  it("refuses documentation without a document", async () => {
    const { findings } = await demo();
    expect(() => applyResponse(findings, [], { from: OFFICE, perFinding: [{ findingId: ids(findings).gap, kind: "provides_documentation" }] }, ctx)).toThrow(/attach the document/);
  });
});

describe("branch: evidence is incomplete", () => {
  /** Proves "we'll send it later" leaves the issue pending, waits with the responsible party, and resumes on arrival. */
  it("waits for the promised document and resumes when it arrives", async () => {
    const { findings } = await demo();
    const { gap } = ids(findings);
    const later: CounterpartyResponse = { from: OFFICE, perFinding: [{ findingId: gap, kind: "will_send_later", neededDocument: "free T4 lab result", responsibleParty: "Quillhaven lab department", promisedBy: "2026-03-31" }] };
    const r = applyResponse(findings, [], later, ctx);
    expect(r.findings.find((f) => f.id === gap)?.status).toBe("pending");
    const task = r.tasks[0];
    expect(task).toMatchObject({ kind: "await_document", findingId: gap, responsibleParty: "Quillhaven lab department", followUpDate: "2026-03-31" });

    const s = sent(r.findings, r.tasks);
    expect(derivePhase(s)).toBe("waiting_document");
    expect(recommendAction(s, TODAY)).toMatchObject({ actionId: "wait", responsibleParty: "Quillhaven lab department", deadline: "2026-03-31", overdue: false });
    // After the promised date, the card proposes a follow-up, which needs approval.
    const late = recommendAction(s, "2026-04-05");
    expect(late).toMatchObject({ actionId: "follow_up", overdue: true, needsApproval: true });
    expect(allowedActions(s, "2026-04-05").map((a) => a.id)).toContain("follow_up");

    // The document arrives: the same case resumes and the finding is settled with the cited document.
    const arrived: CounterpartyResponse = { from: "Quillhaven lab department", perFinding: [{ findingId: gap, kind: "provides_documentation" }], documentId: "doc_lab", documentLabel: "Lab result: free T4" };
    const resumed = applyResponse(r.findings, r.tasks, arrived, { ...ctx, eventId: "evt_2" });
    expect(resumed.findings.find((f) => f.id === gap)?.status).toBe("withdrawn");
    expect(resumed.tasks.find((t) => t.id === task.id)).toMatchObject({ status: "done", fulfilledBy: "doc_lab" });
  });
  /** Proves "needs more info" creates a request that needs approval before anything is sent. */
  it("needs approval to request missing information", async () => {
    const { findings } = await demo();
    const { gap } = ids(findings);
    const r = applyResponse(findings, [], { from: OFFICE, perFinding: [{ findingId: gap, kind: "needs_more_info", neededDocument: "copy of the lab order", responsibleParty: "Northstar Health System" }] }, ctx);
    const s = sent(r.findings, r.tasks);
    expect(derivePhase(s)).toBe("awaiting_approval");
    const card = recommendAction(s, TODAY);
    expect(card).toMatchObject({ actionId: "request_document", needsApproval: true, responsibleParty: "Northstar Health System" });
    expect(canRun(s, "request_document", TODAY, card.target).ok).toBe(false);
  });
});

describe("mergeFindings", () => {
  /** Proves rerunning the audit keeps recorded statuses and drops only untouched findings that vanished. */
  it("keeps statuses across audit reruns", async () => {
    const { findings } = await demo();
    const { dup, gap } = ids(findings);
    const r = applyResponse(findings, [], { from: OFFICE, perFinding: [{ findingId: dup, kind: "confirms_error" }] }, ctx);
    const rerun = mergeFindings(r.findings, findings);
    expect(rerun.find((f) => f.id === dup)?.status).toBe("confirmed");
    expect(rerun.find((f) => f.id === gap)?.status).toBe("potential");
    const without = mergeFindings(r.findings, findings.filter((f) => f.id !== dup && f.id !== gap));
    expect(without.map((f) => f.id)).toContain(dup);
    expect(without.map((f) => f.id)).not.toContain(gap);
  });
});

describe("resolution", () => {
  /** Proves the case resolves only when every issue is verified or withdrawn. */
  it("resolves after verification plus withdrawal", async () => {
    const { bill, findings } = await demo();
    const { dup, eob, gap } = ids(findings);
    const confirmed = applyResponse(findings, [], { from: OFFICE, perFinding: [{ findingId: dup, kind: "confirms_error" }, { findingId: eob, kind: "confirms_error" }, { findingId: gap, kind: "provides_documentation" }], documentId: "doc_lab" }, ctx);
    const cmp = compareRevised(bill, revisedOf(bill), confirmed.findings);
    const v = applyVerification(confirmed.findings, confirmed.tasks, cmp, { documentId: "doc_revised", receivedAt: "2026-04-02" });
    const s = sent(v.findings, v.tasks);
    expect(derivePhase(s)).toBe("resolved");
    expect(recommendAction(s, TODAY).title).toBe("Case resolved");
  });
});
