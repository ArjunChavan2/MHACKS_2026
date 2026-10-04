/**
 * @file Proves the adaptive case service end to end (SPEC.md §6 MVP 2 exit criteria) on the memory
 * store and on real Postgres (PGlite with the committed migrations): approval gate, all three
 * branches, wait → resume, revised-statement verification, and identical state after reload.
 */
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ActionRefusedError, recordResponse, runCaseAction } from "@/lib/cases/caseflow";
import { CaseRuleError } from "@/lib/cases/responses";
import { auditCase, confirmDocument, draftLetter, ingestSample, loadCase } from "@/lib/cases/service";
import { memoryStore, pgStore, type CaseStore } from "@/lib/cases/store";
import type { Finding } from "@/lib/types";

const g = globalThis as typeof globalThis & { __mhStore?: CaseStore };
const AS_PRINTED = { corrections: {}, confirmedPaths: [], acknowledgeTotalsMismatch: false };
const OFFICE = "Quillhaven Medical Group billing office";
let client: PGlite;
const saved = { gemini: process.env.GEMINI_API_KEY, xai: process.env.XAI_API_KEY, today: process.env.DEMO_TODAY };

beforeAll(async () => {
  // Template letters only (no model calls) and a fixed "today" for follow-up dates.
  delete process.env.GEMINI_API_KEY;
  delete process.env.XAI_API_KEY;
  process.env.DEMO_TODAY = "2026-03-24";
  client = new PGlite();
  await migrate(drizzle(client), { migrationsFolder: "db/migrations" });
});

afterAll(async () => {
  g.__mhStore = undefined;
  await client.close();
  if (saved.gemini) process.env.GEMINI_API_KEY = saved.gemini;
  if (saved.xai) process.env.XAI_API_KEY = saved.xai;
  if (saved.today) process.env.DEMO_TODAY = saved.today;
  else delete process.env.DEMO_TODAY;
});

/**
 * Sets up a case through the dispute being drafted: sample bill + EOB, confirm, audit, draft.
 *
 * @returns Case ID, bill ID, and the finding IDs by rule.
 */
async function drafted() {
  const bill = await ingestSample(null, "sample-bill");
  const eob = await ingestSample(bill.caseId, "sample-eob");
  await confirmDocument(bill.documentId, AS_PRINTED);
  await confirmDocument(eob.documentId, AS_PRINTED);
  const audit = await auditCase(bill.caseId, bill.documentId, eob.documentId);
  await draftLetter(bill.caseId, bill.documentId, eob.documentId);
  const by = (rule: Finding["rule"]) => audit.findings.find((f) => f.rule === rule)?.id as string;
  return { caseId: bill.caseId, billId: bill.documentId, eobId: eob.documentId, dup: by("duplicate_charge"), eob: by("bill_exceeds_eob"), gap: by("documentation_gap") };
}

/** The current case state. */
async function state(caseId: string) {
  const v = await loadCase(caseId);
  if (!v) throw new Error("case missing");
  return v.state;
}

/** Sends the drafted dispute with the patient's approval. */
async function send(caseId: string) {
  const s = await state(caseId);
  return runCaseAction(caseId, { actionId: "send_dispute", target: s.next.target, approve: true });
}

describe.each([
  ["memory", () => memoryStore()],
  ["postgres", () => pgStore(drizzle(client))],
] as const)("adaptive case on the %s store", (_name, makeStore) => {
  beforeEach(() => {
    g.__mhStore = makeStore();
  });

  /** Proves nothing is sent without approval, and approval is recorded before the send. */
  it("needs approval to send the dispute", async () => {
    const c = await drafted();
    const s = await state(c.caseId);
    expect(s.phase).toBe("awaiting_approval");
    expect(s.next).toMatchObject({ actionId: "send_dispute", needsApproval: true });
    await expect(runCaseAction(c.caseId, { actionId: "send_dispute", target: s.next.target })).rejects.toBeInstanceOf(ActionRefusedError);
    await expect(runCaseAction(c.caseId, { actionId: "follow_up", approve: true })).rejects.toThrow(/not allowed/);
    const after = await send(c.caseId);
    expect(after.phase).toBe("waiting_response");
    expect(after.timeline.map((e) => e.type)).toEqual(expect.arrayContaining(["approval_recorded", "dispute_sent"]));
  });

  /** Proves the confirms branch: offered → waiting for the revised statement → verified and confirmed. */
  it("confirms the error and verifies it on the revised statement", async () => {
    const c = await drafted();
    await send(c.caseId);
    const confirmed = await recordResponse(c.caseId, { from: OFFICE, perFinding: [{ findingId: c.dup, kind: "confirms_error" }, { findingId: c.eob, kind: "confirms_error" }], attachSample: "response-confirms" });
    expect(confirmed.phase).toBe("waiting_document");
    expect(confirmed.savings).toEqual({ questionedCents: 12200, offeredCents: 6800, confirmedCents: null });
    expect(confirmed.next).toMatchObject({ actionId: "wait", title: "Waiting for the revised statement" });

    // Rerunning the audit must not erase the recorded statuses.
    const rerun = await auditCase(c.caseId, c.billId, c.eobId);
    expect(rerun.findings.find((f) => f.id === c.dup)?.status).toBe("confirmed");

    const revised = await ingestSample(c.caseId, "revised-statement");
    expect((await state(c.caseId)).phase).toBe("verifying");
    expect((await confirmDocument(revised.documentId, AS_PRINTED)).ok).toBe(true);
    const v = await state(c.caseId);
    expect(v.savings).toEqual({ questionedCents: 5400, offeredCents: 0, confirmedCents: 6800 });
    expect(v.verification?.removedLines).toEqual([5]);
    expect(v.tasks.every((t) => t.status === "done")).toBe(true);
    const view = await loadCase(c.caseId);
    expect(view?.audit?.findings.find((f) => f.id === c.dup)).toMatchObject({ status: "confirmed", verified: true });
    // The free T4 question is still open, so the case isn't resolved yet.
    expect(v.phase).toBe("waiting_response");
  });

  /** Proves the disproves branch: the free T4 concern is withdrawn with the cited lab report. */
  it("withdraws the documentation gap when the lab report arrives", async () => {
    const c = await drafted();
    await send(c.caseId);
    const s = await recordResponse(c.caseId, { from: OFFICE, perFinding: [{ findingId: c.gap, kind: "provides_documentation" }], attachSample: "lab-result-ft4", note: "Result attached." });
    expect(s.savings?.questionedCents).toBe(6800);
    const f = (await loadCase(c.caseId))?.audit?.findings.find((x) => x.id === c.gap);
    expect(f?.status).toBe("withdrawn");
    expect(f?.statusSources?.map((x) => x.kind)).toEqual(["response", "document"]);
    expect(s.timeline.map((e) => e.type)).toContain("correspondence_attached");
  });

  /** Proves the incomplete branch: pending with a responsible party, then resumes when the record arrives. */
  it("waits for the promised lab record and resumes when it arrives", async () => {
    const c = await drafted();
    await send(c.caseId);
    const waiting = await recordResponse(c.caseId, { from: OFFICE, perFinding: [{ findingId: c.gap, kind: "will_send_later", neededDocument: "free T4 lab record", responsibleParty: "Quillhaven laboratory", promisedBy: "2026-03-31" }], attachSample: "response-incomplete" });
    expect(waiting.phase).toBe("waiting_document");
    expect(waiting.next).toMatchObject({ actionId: "wait", responsibleParty: "Quillhaven laboratory", deadline: "2026-03-31" });

    // Reload sees exactly the same state from stored data.
    expect(await state(c.caseId)).toEqual(waiting);

    const resumed = await recordResponse(c.caseId, { from: "Quillhaven laboratory", perFinding: [{ findingId: c.gap, kind: "provides_documentation" }], attachSample: "lab-result-ft4" });
    expect(resumed.tasks.find((t) => t.findingId === c.gap)?.status).toBe("done");
    expect(resumed.savings?.questionedCents).toBe(6800);
  });

  /** Proves an overdue promise turns into a follow-up that needs approval, and "I'll do this myself" hands off. */
  it("proposes an approved follow-up when overdue and supports taking over", async () => {
    const c = await drafted();
    await send(c.caseId);
    const w = await recordResponse(c.caseId, { from: OFFICE, perFinding: [{ findingId: c.gap, kind: "will_send_later", neededDocument: "free T4 lab record", promisedBy: "2026-03-20" }] });
    expect(w.next).toMatchObject({ actionId: "follow_up", overdue: true, needsApproval: true });
    const taskId = w.next.target as string;
    const f = await runCaseAction(c.caseId, { actionId: "follow_up", target: taskId, approve: true });
    expect(f.tasks.find((t) => t.id === taskId)?.followUpDate).toBe("2026-03-31");
    const h = await runCaseAction(c.caseId, { actionId: "patient_takes_over", target: taskId });
    expect(h.tasks.find((t) => t.id === taskId)?.status).toBe("patient_handling");
    expect(h.timeline.map((e) => e.type)).toContain("handoff");
  });

  /** Proves bad operator input changes nothing. */
  it("refuses unknown findings and foreign documents", async () => {
    const c = await drafted();
    await expect(recordResponse(c.caseId, { from: OFFICE, perFinding: [{ findingId: "nope", kind: "confirms_error" }] })).rejects.toBeInstanceOf(CaseRuleError);
    await expect(recordResponse(c.caseId, { from: OFFICE, perFinding: [{ findingId: c.gap, kind: "provides_documentation" }], documentId: "doc_other" })).rejects.toThrow(/isn't on this case/);
    expect((await state(c.caseId)).timeline.map((e) => e.type)).not.toContain("response_recorded");
  });
});
