/**
 * @file Proves the two call stages driven by call outcomes the patient confirms: initial (claim) call
 * → success / denied / failed; a denied claim moves to the appeal (secondary) call; denied again
 * escalates. Saved calls are injected as events (ElevenLabs isn't called).
 */
import { beforeEach, describe, expect, it } from "vitest";
import { proposeOutcome } from "@/lib/cases/callOutcome";
import { decideCallOutcome, runCaseAction } from "@/lib/cases/caseflow";
import { auditCase, confirmDocument, draftLetter, ingestSample, loadCase } from "@/lib/cases/service";
import { getStore, memoryStore, type CaseStore } from "@/lib/cases/store";
import type { CallRecord } from "@/lib/calls/history";

const g = globalThis as typeof globalThis & { __mhStore?: CaseStore };
const AS_PRINTED = { corrections: {}, confirmedPaths: [], acknowledgeTotalsMismatch: false };

beforeEach(() => {
  g.__mhStore = memoryStore();
  delete process.env.GEMINI_API_KEY;
  delete process.env.XAI_API_KEY;
});

/** A case with the dispute sent, ready for calls. */
async function sentCase(): Promise<string> {
  const bill = await ingestSample(null, "sample-bill");
  const eob = await ingestSample(bill.caseId, "sample-eob");
  await confirmDocument(bill.documentId, AS_PRINTED);
  await confirmDocument(eob.documentId, AS_PRINTED);
  await auditCase(bill.caseId, bill.documentId, eob.documentId);
  await draftLetter(bill.caseId, bill.documentId, eob.documentId);
  const v = await loadCase(bill.caseId);
  await runCaseAction(bill.caseId, { actionId: "send_dispute", target: v!.state.next.target, approve: true });
  return bill.caseId;
}

/** Saves a fake finished call with extracted values. */
async function saveCall(caseId: string, id: string, extracted: Record<string, string>): Promise<void> {
  const call: CallRecord = { conversationId: id, startedAt: new Date().toISOString(), durationSecs: 60, endedBy: "end_call tool was called.", transcript: [], extracted };
  await getStore().addEvent(caseId, "call_recorded", call);
}

/** The finding with a rule. */
async function finding(caseId: string, rule: string) {
  return (await loadCase(caseId))!.audit!.findings.find((f) => f.rule === rule)!;
}

describe("proposeOutcome", () => {
  /** Proves per-issue values map to responses and empty/failed calls map to no result. */
  it("maps extracted values", async () => {
    const caseId = await sentCase();
    const findings = (await loadCase(caseId))!.audit!.findings;
    const base = { conversationId: "c", startedAt: "", durationSecs: 1, endedBy: null, transcript: [] };
    const p = proposeOutcome({ ...base, extracted: { call_result: "reached_office", duplicate_tsh: "confirmed", eob_difference: "refused", free_t4_documentation: "not_discussed", reference_number: "TK-921" } }, findings, "Quillhaven");
    expect(p?.kind).toBe("response");
    if (p?.kind === "response") {
      expect(p.response.perFinding.map((x) => x.kind)).toEqual(["confirms_error", "refused"]);
      expect(p.response.note).toContain("TK-921");
    }
    expect(proposeOutcome({ ...base, extracted: { call_result: "call_failed" } }, findings, "Q")?.kind).toBe("no_result");
    expect(proposeOutcome({ ...base, extracted: {} }, findings, "Q")).toBeNull();
  });
});

describe("two call stages", () => {
  /** Proves claim denied → appeal call card; appeal succeeds → confirmed and waiting for the revised statement. */
  it("appeals a denied claim and succeeds", async () => {
    const caseId = await sentCase();
    await saveCall(caseId, "call1", { call_result: "reached_office", duplicate_tsh: "refused" });
    await decideCallOutcome(caseId, "call1", "confirm");
    expect((await finding(caseId, "duplicate_charge")).stage).toBe("appeal");
    expect((await loadCase(caseId))!.state.next.title).toBe("Appeal the denial: Billy makes the appeal call");
    await saveCall(caseId, "call2", { call_result: "reached_office", duplicate_tsh: "confirmed" });
    const s = await decideCallOutcome(caseId, "call2", "confirm");
    expect((await finding(caseId, "duplicate_charge")).status).toBe("confirmed");
    expect(s.tasks.some((t) => t.documentNeeded === "revised statement" && t.status === "open")).toBe(true);
  });
  /** Proves a denial on appeal escalates to a written appeal / advocate step. */
  it("escalates when denied again on appeal", async () => {
    const caseId = await sentCase();
    await saveCall(caseId, "call1", { duplicate_tsh: "refused" });
    await decideCallOutcome(caseId, "call1", "confirm");
    await saveCall(caseId, "call2", { duplicate_tsh: "refused" });
    const s = await decideCallOutcome(caseId, "call2", "confirm");
    expect((await finding(caseId, "duplicate_charge")).stage).toBe("escalated");
    expect(s.next.title).toBe("Denied on appeal: send a written appeal or get help");
  });
  /** Proves a failed call opens a follow-up instead of waiting silently, and "not right" changes nothing. */
  it("follows up after a failed call and ignores rejected summaries", async () => {
    const caseId = await sentCase();
    await saveCall(caseId, "bad", { call_result: "call_failed" });
    const before = (await loadCase(caseId))!.state;
    expect(before.callProposals.bad.kind).toBe("no_result");
    const s = await decideCallOutcome(caseId, "bad", "confirm");
    expect(s.tasks.some((t) => t.kind === "request_document" && t.documentNeeded.includes("response to the dispute"))).toBe(true);
    await saveCall(caseId, "wrong", { duplicate_tsh: "confirmed" });
    await decideCallOutcome(caseId, "wrong", "reject");
    expect((await finding(caseId, "duplicate_charge")).status).toBe("potential");
    await expect(decideCallOutcome(caseId, "wrong", "confirm")).rejects.toThrow(/no pending summary/);
  });
});
