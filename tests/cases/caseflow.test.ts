/**
 * @file Proves the adaptive case service end to end (SPEC.md §6 MVP 2 exit criteria) on the memory
 * store and on real Postgres (PGlite with the committed migrations): approval gate, all three
 * branches, wait → resume, revised-statement verification, and identical state after reload.
 */
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  ActionRefusedError,
  recordResponse,
  runCaseAction,
  saveCasePreferences,
  snapshotOf,
} from "@/lib/cases/caseflow";
import {
  attachCaseDocument,
  resumeCaseDocument,
} from "@/lib/cases/attachments";
import { fixturePdf } from "../helpers";
import { PATCH as preferencesRoute } from "@/app/api/cases/[id]/route";
import { POST as attachmentRoute } from "@/app/api/cases/[id]/documents/route";
import { CaseRuleError } from "@/lib/cases/responses";
import {
  auditCase,
  confirmDocument,
  draftLetter,
  ingestSample,
  ingestUpload,
  loadCase,
  reopenReview,
  setFindingExcluded,
} from "@/lib/cases/service";
import { memoryStore, pgStore, type CaseStore } from "@/lib/cases/store";
import type { Finding } from "@/lib/types";

const g = globalThis as typeof globalThis & { __mhStore?: CaseStore };
const AS_PRINTED = {
  corrections: {},
  confirmedPaths: [],
  acknowledgeTotalsMismatch: false,
};
const OFFICE = "Quillhaven Medical Group billing office";
let client: PGlite;
const saved = {
  gemini: process.env.GEMINI_API_KEY,
  xai: process.env.XAI_API_KEY,
  today: process.env.DEMO_TODAY,
};

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
  const by = (rule: Finding["rule"]) =>
    audit.findings.find((f) => f.rule === rule)?.id as string;
  return {
    caseId: bill.caseId,
    billId: bill.documentId,
    eobId: eob.documentId,
    dup: by("duplicate_charge"),
    eob: by("bill_exceeds_eob"),
    gap: by("documentation_gap"),
  };
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
  return runCaseAction(caseId, {
    actionId: "send_dispute",
    target: s.next.target,
    approve: true,
  });
}

describe.each([
  ["memory", () => memoryStore()],
  ["postgres", () => pgStore(drizzle(client))],
] as const)("adaptive case on the %s store", (_name, makeStore) => {
  beforeEach(() => {
    g.__mhStore = makeStore();
  });

  /** Patient exclusions persist on either store, survive re-auditing, and never enter a new letter. */
  it("excludes and restores issues without treating exclusion as a verified resolution", async () => {
    const c = await drafted();
    const before = (await loadCase(c.caseId))!;
    const finding = before.audit!.findings.find((f) => f.id === c.dup)!;
    const selected = await setFindingExcluded(c.caseId, c.dup, true);
    expect(selected.draft).toBeNull();
    expect(selected.audit!.findings.find((f) => f.id === c.dup)).toEqual({
      ...finding,
      patientExcluded: true,
    });
    expect(
      (await loadCase(c.caseId))!.audit!.findings.find((f) => f.id === c.dup)!
        .patientExcluded,
    ).toBe(true);
    const rerun = await auditCase(c.caseId, c.billId, c.eobId);
    expect(rerun.findings.find((f) => f.id === c.dup)!.patientExcluded).toBe(
      true,
    );
    await draftLetter(c.caseId, c.billId, c.eobId);
    const stored = await g.__mhStore!.getCase(c.caseId);
    const lastLetter = stored!.events
      .filter((e) => e.type === "letter_drafted")
      .at(-1)!;
    expect((lastLetter.data as { findings: string[] }).findings).not.toContain(
      c.dup,
    );
    for (const f of rerun.findings)
      await setFindingExcluded(c.caseId, f.id, true);
    const none = (await loadCase(c.caseId))!;
    expect(none.audit!.verdict.questionedCents).toBe(0);
    expect(none.state.phase).toBe("audited");
    await expect(draftLetter(c.caseId, c.billId, c.eobId)).rejects.toThrow(
      /nothing to dispute/,
    );
    const restored = await setFindingExcluded(c.caseId, c.dup, false);
    expect(
      restored.audit!.findings.find((f) => f.id === c.dup)!.patientExcluded,
    ).toBe(false);
    expect(restored.audit!.verdict.questionedCents).toBeGreaterThan(0);
    await expect(
      setFindingExcluded(c.caseId, "unknown-finding", true),
    ).rejects.toThrow(/Unknown finding/);
  });

  /** Exclusion cannot invalidate a letter whose action the patient has already approved. */
  it("refuses to change selected issues after sending", async () => {
    const c = await drafted();
    await send(c.caseId);
    await expect(setFindingExcluded(c.caseId, c.dup, true)).rejects.toThrow(
      /recorded approvals/,
    );
  });

  /** Reopening preserves corrections, requires confirmation, and makes an earlier draft unavailable across reloads. */
  it("reopens an unsent review and replaces stale findings and drafts", async () => {
    const c = await drafted();
    const old = await loadCase(c.caseId);
    const reopened = await reopenReview(c.caseId);
    expect(reopened.audit).toBeNull();
    expect(reopened.draft).toBeNull();
    expect(reopened.documents.every((d) => !d.confirmed)).toBe(true);
    expect(reopened.state.phase).toBe("intake");
    await expect(send(c.caseId)).rejects.toThrow();
    await expect(auditCase(c.caseId, c.billId, c.eobId)).rejects.toThrow(
      /must be confirmed/,
    );
    expect(
      await confirmDocument(c.billId, {
        ...AS_PRINTED,
        corrections: { "lines.4.code": "84441" },
      }),
    ).toEqual({ ok: true });
    expect(await confirmDocument(c.eobId, AS_PRINTED)).toEqual({ ok: true });
    const audit = await auditCase(c.caseId, c.billId, c.eobId);
    expect(audit.findings.some((f) => f.rule === "duplicate_charge")).toBe(
      false,
    );
    const refreshed = await loadCase(c.caseId);
    expect(refreshed?.draft).toBeNull();
    const bill = refreshed?.documents.find(
      (d) => d.ingest.documentId === c.billId,
    );
    expect(
      bill?.ingest.result.kind === "bill" &&
        bill.ingest.result.bill.lines[4].code.raw,
    ).toBe("84441");
    await draftLetter(c.caseId, c.billId, c.eobId);
    expect((await loadCase(c.caseId))?.draft).not.toEqual(old?.draft);
    const again = await reopenReview(c.caseId);
    const saved = again.documents.find((d) => d.ingest.documentId === c.billId);
    expect(
      saved?.ingest.result.kind === "bill" &&
        saved.ingest.result.bill.lines[4].code.raw,
    ).toBe("84441");
  });

  /** An approved/sent dispute must retain its original documents and draft instead of being silently rewritten. */
  it("refuses to reopen a case after patient approval and sending", async () => {
    const c = await drafted();
    await send(c.caseId);
    const before = await loadCase(c.caseId);
    await expect(reopenReview(c.caseId)).rejects.toThrow(/recorded approvals/);
    expect(await loadCase(c.caseId)).toEqual(before);
  });

  /** Proves nothing is sent without approval, and approval is recorded before the send. */
  it("needs approval to send the dispute", async () => {
    const c = await drafted();
    const s = await state(c.caseId);
    expect(s.phase).toBe("awaiting_approval");
    expect(s.next).toMatchObject({
      actionId: "send_dispute",
      needsApproval: true,
    });
    await expect(
      runCaseAction(c.caseId, {
        actionId: "send_dispute",
        target: s.next.target,
      }),
    ).rejects.toBeInstanceOf(ActionRefusedError);
    await expect(
      runCaseAction(c.caseId, { actionId: "follow_up", approve: true }),
    ).rejects.toThrow(/not allowed/);
    const after = await send(c.caseId);
    expect(after.phase).toBe("waiting_response");
    expect(after.timeline.map((e) => e.type)).toEqual(
      expect.arrayContaining(["approval_recorded", "dispute_sent"]),
    );
  });

  /** Proves the confirms branch: offered → waiting for the revised statement → verified and confirmed. */
  it("confirms the error and verifies it on the revised statement", async () => {
    const c = await drafted();
    await send(c.caseId);
    const confirmed = await recordResponse(c.caseId, {
      from: OFFICE,
      perFinding: [
        { findingId: c.dup, kind: "confirms_error" },
        { findingId: c.eob, kind: "confirms_error" },
      ],
      attachSample: "response-confirms",
    });
    expect(confirmed.phase).toBe("waiting_document");
    expect(confirmed.savings).toEqual({
      questionedCents: 12200,
      offeredCents: 6800,
      confirmedCents: null,
    });
    expect(confirmed.next).toMatchObject({
      actionId: "wait",
      title: "Waiting for the revised statement",
    });

    // Rerunning the audit must not erase the recorded statuses.
    const rerun = await auditCase(c.caseId, c.billId, c.eobId);
    expect(rerun.findings.find((f) => f.id === c.dup)?.status).toBe(
      "confirmed",
    );

    const revised = await ingestSample(c.caseId, "revised-statement");
    expect((await state(c.caseId)).phase).toBe("verifying");
    expect((await confirmDocument(revised.documentId, AS_PRINTED)).ok).toBe(
      true,
    );
    const v = await state(c.caseId);
    expect(v.savings).toEqual({
      questionedCents: 5400,
      offeredCents: 0,
      confirmedCents: 6800,
    });
    expect(v.verification?.removedLines).toEqual([5]);
    expect(v.tasks.every((t) => t.status === "done")).toBe(true);
    const view = await loadCase(c.caseId);
    expect(view?.audit?.findings.find((f) => f.id === c.dup)).toMatchObject({
      status: "confirmed",
      verified: true,
    });
    // The free T4 question is still open, so the case isn't resolved yet.
    expect(v.phase).toBe("waiting_response");
  });

  /** Proves the disproves branch: the free T4 concern is withdrawn with the cited lab report. */
  it("withdraws the documentation gap when the lab report arrives", async () => {
    const c = await drafted();
    await send(c.caseId);
    const s = await recordResponse(c.caseId, {
      from: OFFICE,
      perFinding: [{ findingId: c.gap, kind: "provides_documentation" }],
      attachSample: "lab-result-ft4",
      note: "Result attached.",
    });
    expect(s.savings?.questionedCents).toBe(6800);
    const f = (await loadCase(c.caseId))?.audit?.findings.find(
      (x) => x.id === c.gap,
    );
    expect(f?.status).toBe("withdrawn");
    expect(f?.statusSources?.map((x) => x.kind)).toEqual([
      "response",
      "document",
    ]);
    expect(s.timeline.map((e) => e.type)).toContain("correspondence_attached");
  });

  /** Proves the incomplete branch: pending with a responsible party, then resumes when the record arrives. */
  it("waits for the promised lab record and resumes when it arrives", async () => {
    const c = await drafted();
    await send(c.caseId);
    const waiting = await recordResponse(c.caseId, {
      from: OFFICE,
      perFinding: [
        {
          findingId: c.gap,
          kind: "will_send_later",
          neededDocument: "free T4 lab record",
          responsibleParty: "Quillhaven laboratory",
          promisedBy: "2026-03-31",
        },
      ],
      attachSample: "response-incomplete",
    });
    expect(waiting.phase).toBe("waiting_document");
    expect(waiting.next).toMatchObject({
      actionId: "wait",
      responsibleParty: "Quillhaven laboratory",
      deadline: "2026-03-31",
    });

    // Reload sees exactly the same state from stored data.
    expect(await state(c.caseId)).toEqual(waiting);

    const resumed = await recordResponse(c.caseId, {
      from: "Quillhaven laboratory",
      perFinding: [{ findingId: c.gap, kind: "provides_documentation" }],
      attachSample: "lab-result-ft4",
    });
    expect(resumed.tasks.find((t) => t.findingId === c.gap)?.status).toBe(
      "done",
    );
    expect(resumed.savings?.questionedCents).toBe(6800);
  });

  /** Proves an overdue promise turns into a follow-up that needs approval, and "I'll do this myself" hands off. */
  it("proposes an approved follow-up when overdue and supports taking over", async () => {
    const c = await drafted();
    await send(c.caseId);
    const w = await recordResponse(c.caseId, {
      from: OFFICE,
      perFinding: [
        {
          findingId: c.gap,
          kind: "will_send_later",
          neededDocument: "free T4 lab record",
          promisedBy: "2026-03-20",
        },
      ],
    });
    expect(w.next).toMatchObject({
      actionId: "follow_up",
      overdue: true,
      needsApproval: true,
    });
    const taskId = w.next.target as string;
    const f = await runCaseAction(c.caseId, {
      actionId: "follow_up",
      target: taskId,
      approve: true,
    });
    expect(f.tasks.find((t) => t.id === taskId)?.followUpDate).toBe(
      "2026-03-31",
    );
    const h = await runCaseAction(c.caseId, {
      actionId: "patient_takes_over",
      target: taskId,
    });
    expect(h.tasks.find((t) => t.id === taskId)?.status).toBe(
      "patient_handling",
    );
    expect(h.timeline.map((e) => e.type)).toContain("handoff");
  });

  /** Proves supported restrictions persist, block contact, and invalidate older approvals. */
  it("persists choices and requires new approval after preferences change", async () => {
    const c = await drafted();
    const before = await state(c.caseId);
    const choices = {
      goal: "Review this bill without paying",
      noPayments: true,
      pauseContact: true,
    };
    const held = await saveCasePreferences(c.caseId, choices);
    expect(held.preferences).toMatchObject(choices);
    expect((await state(c.caseId)).preferences).toEqual(held.preferences);
    expect(held.next.title).toBe("Contact is on hold");
    expect(held.allowed.some((a) => a.needsApproval)).toBe(false);
    await expect(
      runCaseAction(c.caseId, {
        actionId: "send_dispute",
        target: before.next.target,
        approve: true,
      }),
    ).rejects.toBeInstanceOf(ActionRefusedError);
    await g.__mhStore!.addEvent(c.caseId, "approval_recorded", {
      action: "send_dispute",
      target: before.next.target,
    });
    await saveCasePreferences(c.caseId, { ...choices, pauseContact: false });
    expect(
      snapshotOf((await g.__mhStore!.getCase(c.caseId))!).snapshot.approvals,
    ).toEqual([]);
    await expect(
      runCaseAction(c.caseId, {
        actionId: "send_dispute",
        target: before.next.target,
      }),
    ).rejects.toThrow(/approval/);
    await send(c.caseId);
    expect((await state(c.caseId)).phase).toBe("waiting_response");
  });

  /** Proves attachment receipt cannot fulfill a task or confirm savings before patient confirmation. */
  it("resumes a patient-attached revision only after confirmation", async () => {
    const c = await drafted();
    await send(c.caseId);
    await recordResponse(c.caseId, {
      from: OFFICE,
      perFinding: [{ findingId: c.dup, kind: "confirms_error" }],
      attachSample: "response-confirms",
    });
    const task = (await state(c.caseId)).tasks.find(
      (t) => t.documentNeeded === "revised statement",
    )!;
    const revision = await ingestSample(c.caseId, "revised-statement");
    await attachCaseDocument(c.caseId, revision.documentId, task.id);
    await attachCaseDocument(c.caseId, revision.documentId, task.id);
    expect(
      (await state(c.caseId)).tasks.find((t) => t.id === task.id)?.status,
    ).toBe("open");
    expect((await state(c.caseId)).savings?.confirmedCents).toBeNull();
    expect((await confirmDocument(revision.documentId, AS_PRINTED)).ok).toBe(
      true,
    );
    await resumeCaseDocument(c.caseId, revision.documentId);
    const after = await state(c.caseId);
    expect(after.tasks.find((t) => t.id === task.id)).toMatchObject({
      status: "done",
      fulfilledBy: revision.documentId,
    });
    expect(after.savings?.confirmedCents).toBe(6800);
    expect(
      after.timeline.filter((e) => e.type === "case_document_attached"),
    ).toHaveLength(1);
    expect(
      after.timeline.filter((e) => e.type === "case_document_checked"),
    ).toHaveLength(1);
  });

  /** Proves a newly confirmed EOB reruns deterministic checks and preserves response statuses. */
  it("checks an arrived EOB and fulfills only its selected task", async () => {
    const c = await drafted();
    await send(c.caseId);
    await recordResponse(c.caseId, {
      from: OFFICE,
      perFinding: [
        { findingId: c.dup, kind: "confirms_error" },
        { findingId: c.gap, kind: "will_send_later", neededDocument: "EOB" },
      ],
    });
    const task = (await state(c.caseId)).tasks.find(
      (t) => t.documentNeeded === "EOB",
    )!;
    const eob = await ingestSample(c.caseId, "sample-eob");
    await attachCaseDocument(c.caseId, eob.documentId, task.id);
    expect(
      (await state(c.caseId)).tasks.find((t) => t.id === task.id)?.status,
    ).toBe("open");
    await confirmDocument(eob.documentId, AS_PRINTED);
    expect(
      (await state(c.caseId)).tasks.find((t) => t.id === task.id)?.status,
    ).toBe("done");
    expect(
      (await loadCase(c.caseId))?.audit?.findings.find((f) => f.id === c.dup)
        ?.status,
    ).toBe("confirmed");
    expect(
      (await state(c.caseId)).tasks.find(
        (t) => t.documentNeeded === "revised statement",
      )?.status,
    ).toBe("open");
  });

  /** Proves a mismatched revision stays unconfirmed and cannot produce false savings. */
  it("refuses a revision from a different account before locking confirmation", async () => {
    const c = await drafted();
    const revision = await ingestSample(c.caseId, "revised-statement");
    await attachCaseDocument(c.caseId, revision.documentId);
    const result = await confirmDocument(revision.documentId, {
      ...AS_PRINTED,
      corrections: { "header.accountNumber": "ANOTHER-ACCOUNT" },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.blocking.join(" ")).toMatch(/account|match/);
    expect(
      (await g.__mhStore!.getDocument(revision.documentId))?.confirmed,
    ).toBeNull();
    expect((await state(c.caseId)).savings?.confirmedCents).toBeNull();
  });

  /** Proves foreign documents/tasks and unsupported evidence cannot change the case. */
  it("refuses foreign attachments, unsupported task matches and cross-case audits", async () => {
    const c = await drafted();
    const other = await drafted();
    const eob = await ingestSample(c.caseId, "sample-eob");
    await expect(attachCaseDocument(c.caseId, other.eobId)).rejects.toThrow(
      /not on this case/,
    );
    await expect(
      attachCaseDocument(c.caseId, eob.documentId, "foreign-task"),
    ).rejects.toThrow(/cannot fulfill/);
    await expect(auditCase(c.caseId, other.billId, c.eobId)).rejects.toThrow(
      /belong to this case/,
    );
    await expect(draftLetter(c.caseId, c.billId, other.eobId)).rejects.toThrow(
      /belong to this case/,
    );
    await expect(
      attachCaseDocument(c.caseId, c.billId),
    ).resolves.toBeUndefined();
  });

  /** Proves strict API boundaries reject unknown choices and foreign attachment identifiers. */
  it("validates preference and attachment routes before mutation", async () => {
    const c = await drafted();
    const other = await drafted();
    /** Constructs a synthetic JSON request for direct boundary validation. */
    const request = (body: unknown) =>
      new Request("http://localhost/api/cases/demo", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    const context = { params: Promise.resolve({ id: c.caseId }) };
    const bad = await preferencesRoute(
      request({
        goal: "Review",
        noPayments: true,
        pauseContact: false,
        inventedPermission: true,
      }),
      context,
    );
    expect(bad.status).toBe(400);
    expect((await state(c.caseId)).preferences.version).toBeNull();
    expect(
      (
        await preferencesRoute(
          request({ goal: "Review", noPayments: true, pauseContact: false }),
          context,
        )
      ).status,
    ).toBe(200);
    const foreign = await attachmentRoute(
      request({ documentId: other.billId }),
      context,
    );
    expect(foreign.status).toBe(400);
    expect(
      (await state(c.caseId)).timeline.some(
        (e) => e.type === "case_document_attached",
      ),
    ).toBe(false);
  });

  /** Proves sequential retries in a known case reuse the file without another extraction or receipt. */
  it("reuses an identical upload already stored on the case", async () => {
    const c = await drafted();
    const before = (await g.__mhStore!.getCase(c.caseId))!;
    const upload = await ingestUpload(
      c.caseId,
      "retry.pdf",
      "application/pdf",
      fixturePdf("sample-bill"),
    );
    expect(upload.documentId).toBe(c.billId);
    const after = (await g.__mhStore!.getCase(c.caseId))!;
    expect(after.documents.length).toBe(before.documents.length);
    expect(
      after.events.filter((e) => e.type === "document_received").length,
    ).toBe(before.events.filter((e) => e.type === "document_received").length);
  });

  /** Proves bad operator input changes nothing. */
  it("refuses unknown findings and foreign documents", async () => {
    const c = await drafted();
    await expect(
      recordResponse(c.caseId, {
        from: OFFICE,
        perFinding: [{ findingId: "nope", kind: "confirms_error" }],
      }),
    ).rejects.toBeInstanceOf(CaseRuleError);
    await expect(
      recordResponse(c.caseId, {
        from: OFFICE,
        perFinding: [{ findingId: c.gap, kind: "provides_documentation" }],
        documentId: "doc_other",
      }),
    ).rejects.toThrow(/isn't on this case/);
    expect((await state(c.caseId)).timeline.map((e) => e.type)).not.toContain(
      "response_recorded",
    );
  });
});
