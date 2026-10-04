/** @file Call authorization, case ownership, rehearsal isolation, outcomes and timeout guards. No external calls occur. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  answerCallDecision,
  changeCall,
  loadCallWorkspace,
  prepareCall,
  refreshCall,
  saveCallOutcome,
  startCall,
} from "@/lib/calls/workspace";
import { saveCasePreferences } from "@/lib/cases/caseflow";
import {
  auditCase,
  confirmDocument,
  ingestSample,
  loadCase,
} from "@/lib/cases/service";
import { getStore, memoryStore, type CaseStore } from "@/lib/cases/store";
import type { CallReview } from "@/lib/calls/workspace-types";
import { POST as callAction } from "@/app/api/cases/[id]/call-workspace/route";
import { POST as decisionTool } from "@/app/api/calls/decision/route";

/** Test-local store override; resets every case before a scenario. */
const g = globalThis as typeof globalThis & { __mhStore?: CaseStore };
/** Explicit patient-approved synthetic phone destinations, never contacted by the tests. */
const REVIEW: CallReview = {
  recipient: "Synthetic office",
  phone: "+15555550100",
  patientPhone: "+15555550101",
  purpose: "Get written billing information",
  disclosures: ["account"],
};
/** Saved preferences used to demonstrate stale approval and contact holds. */
const PREFS = { goal: "Review my bill", noPayments: true, pauseContact: false };
/** Normal checked fixture confirmation body. */
const CONFIRM = {
  corrections: {},
  confirmedPaths: [],
  acknowledgeTotalsMismatch: false,
};

/** Creates an eligible case with confirmed administrative disclosures and versioned patient preferences. */
async function readyCase() {
  const bill = await ingestSample(null, "sample-bill");
  expect((await confirmDocument(bill.documentId, CONFIRM)).ok).toBe(true);
  await saveCasePreferences(bill.caseId, PREFS);
  return bill;
}

beforeEach(() => {
  g.__mhStore = memoryStore();
  vi.stubEnv("CALL_WORKSPACE_ENABLED", "false");
  vi.stubGlobal(
    "fetch",
    vi.fn(() => {
      throw new Error("Unexpected real provider call");
    }),
  );
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("patient call workspace", () => {
  /** Explicit route approval is required; arbitrary provider IDs and missing approval are refused. */
  it("requires explicit approval in the action route and protects the agent tool", async () => {
    const bill = await readyCase();
    const response = await callAction(
      new Request("https://example.test/call", {
        method: "POST",
        body: JSON.stringify({
          action: "prepare",
          review: REVIEW,
          mode: "rehearsal",
        }),
      }),
      { params: Promise.resolve({ id: bill.caseId }) },
    );
    expect(response.status).toBe(400);
    expect((await loadCallWorkspace(bill.caseId)).sessions).toEqual([]);
    expect(
      (
        await decisionTool(
          new Request("https://example.test/decision", {
            method: "POST",
            body: "{}",
          }),
        )
      ).status,
    ).toBe(401);
  });
  /** A held case, unsaved preference version, unavailable field and another case's session cannot authorize contact. */
  it("rejects missing choices, unavailable scope, holds and cross-case sessions", async () => {
    const unready = await ingestSample(null, "sample-bill");
    await expect(
      prepareCall(unready.caseId, REVIEW, "rehearsal"),
    ).rejects.toThrow(/Save your case goal/);
    const bill = await readyCase();
    await expect(
      prepareCall(
        bill.caseId,
        { ...REVIEW, disclosures: ["findings"] },
        "rehearsal",
      ),
    ).rejects.toThrow(/not available/);
    const session = await prepareCall(bill.caseId, REVIEW, "rehearsal");
    await expect(startCall(unready.caseId, session.id)).rejects.toThrow(
      /Unknown call session/,
    );
    await saveCasePreferences(bill.caseId, { ...PREFS, pauseContact: true });
    await expect(startCall(bill.caseId, session.id)).rejects.toThrow(
      /choices changed/,
    );
    await expect(prepareCall(bill.caseId, REVIEW, "live")).rejects.toThrow(
      /clear the contact hold/,
    );
    expect(fetch).not.toHaveBeenCalled();
  });
  /** A changed goal invalidates approval even with contact allowed; replaced plans cannot start. */
  it("invalidates stale and replaced approved plans", async () => {
    const bill = await readyCase();
    const old = await prepareCall(bill.caseId, REVIEW, "rehearsal");
    const latest = await prepareCall(bill.caseId, REVIEW, "rehearsal");
    await expect(startCall(bill.caseId, old.id)).rejects.toThrow(/replaced/);
    await saveCasePreferences(bill.caseId, {
      ...PREFS,
      goal: "Request documentation",
    });
    await expect(startCall(bill.caseId, latest.id)).rejects.toThrow(
      /choices changed/,
    );
    expect(fetch).not.toHaveBeenCalled();
  });
  /** Rehearsal advances only by patient controls, saves original turn references, survives reload and changes no savings. */
  it("completes a labeled rehearsal and saves an outcome without external contact or savings", async () => {
    const bill = await readyCase();
    await auditCase(bill.caseId, bill.documentId, null);
    const before = (await loadCase(bill.caseId))!.state.savings;
    const plan = await prepareCall(bill.caseId, REVIEW, "rehearsal");
    await startCall(bill.caseId, plan.id);
    await expect(startCall(bill.caseId, plan.id)).rejects.toThrow(
      /already been used/,
    );
    const offered = await changeCall(bill.caseId, plan.id, "rehearsal_next");
    expect(offered.decision?.statement).toContain("not in writing");
    await answerCallDecision(
      bill.caseId,
      plan.id,
      offered.decision!.id,
      "ask_written",
    );
    const done = await changeCall(bill.caseId, plan.id, "rehearsal_next");
    expect(done.status).toBe("completed");
    await expect(
      saveCallOutcome(bill.caseId, {
        sessionId: plan.id,
        turnIndexes: [99],
        nextStep: "follow_up",
        dueDate: null,
        note: "",
      }),
    ).rejects.toThrow(/not in this call/);
    const outcome = {
      sessionId: plan.id,
      turnIndexes: [1],
      nextStep: "request_written_proof" as const,
      dueDate: "2026-10-10",
      note: "Need written confirmation",
    };
    await saveCallOutcome(bill.caseId, outcome);
    expect((await loadCallWorkspace(bill.caseId)).sessions[0].outcome).toEqual(
      outcome,
    );
    expect((await loadCase(bill.caseId))!.state.savings).toEqual(before);
    expect(fetch).not.toHaveBeenCalled();
  });
  /** An expired office proposal cannot become an agreement or a late accepted decision. */
  it("turns an expired decision into decline and keeps end/takeover available", async () => {
    const bill = await readyCase();
    const plan = await prepareCall(bill.caseId, REVIEW, "rehearsal");
    await startCall(bill.caseId, plan.id);
    const offered = await changeCall(bill.caseId, plan.id, "rehearsal_next");
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 41000);
    const answered = await answerCallDecision(
      bill.caseId,
      plan.id,
      offered.decision!.id,
      "ask_written",
    );
    expect(answered.decision?.resolution).toBe("decline");
    await saveCasePreferences(bill.caseId, { ...PREFS, pauseContact: true });
    expect((await changeCall(bill.caseId, plan.id, "takeover")).status).toBe(
      "handed_back",
    );
    expect(fetch).not.toHaveBeenCalled();
  });
  /** The real call path fails closed until a scoped agent is explicitly configured. */
  it("never places a live call when the deployment is not enabled", async () => {
    const bill = await readyCase();
    const plan = await prepareCall(bill.caseId, REVIEW, "live");
    await expect(startCall(bill.caseId, plan.id)).rejects.toThrow(
      /not enabled/,
    );
    expect(fetch).not.toHaveBeenCalled();
  });
  /** Exact call SID metadata, rather than global recency, prevents another case's transcript being attached. */
  it("polls a case-owned call and ignores unrelated provider transcripts", async () => {
    const bill = await readyCase();
    const plan = await prepareCall(bill.caseId, REVIEW, "rehearsal");
    const sid = `CA${"a".repeat(32)}`;
    await getStore().addEvent(bill.caseId, "call_session_updated", {
      ...plan,
      mode: "live",
      status: "in-progress",
      sid,
    });
    for (const [name, value] of Object.entries({
      APP_URL: "https://example.test",
      TWILIO_ACCOUNT_SID: "ACtest",
      TWILIO_API_KEY_SID: "SKtest",
      TWILIO_API_KEY_SECRET: "test",
      TWILIO_PHONE_NUMBER: "+15555550100",
      ELEVENLABS_API_KEY: "test",
      ELEVENLABS_AGENT_ID: "agent_test",
    }))
      vi.stubEnv(name, value);
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async (url: string) =>
          new Response(
            JSON.stringify(
              url.includes("api.twilio")
                ? { status: "completed", duration: "20" }
                : url.includes("conversations?")
                  ? {
                      conversations: [
                        { conversation_id: "conv_other", status: "done" },
                      ],
                    }
                  : {
                      conversation_id: "conv_other",
                      status: "done",
                      metadata: {
                        phone_call: { call_sid: `CA${"b".repeat(32)}` },
                      },
                      transcript: [
                        {
                          role: "user",
                          message: "Other patient's information",
                        },
                      ],
                    },
            ),
          ),
      ),
    );
    const refreshed = await refreshCall(bill.caseId, plan.id);
    expect(refreshed.status).toBe("completed");
    expect(refreshed.transcript).toEqual([]);
    expect(refreshed.record).toBeNull();
    expect((await loadCase(bill.caseId))!.state.calls).toEqual([]);
    // The matching conversation preserves original turns and the newer main branch's proposal metadata.
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async (url: string) =>
          new Response(
            JSON.stringify(
              url.includes("api.twilio")
                ? { status: "completed", duration: "20" }
                : url.includes("conversations?")
                  ? {
                      conversations: [
                        { conversation_id: "conv_owned", status: "done" },
                      ],
                    }
                  : {
                      conversation_id: "conv_owned",
                      status: "done",
                      metadata: { phone_call: { call_sid: sid } },
                      transcript: [
                        {
                          role: "user",
                          message: "  Please send written confirmation.  ",
                          time_in_call_secs: 12,
                        },
                      ],
                      analysis: {
                        data_collection_results: {
                          duplicate_tsh: { value: "confirmed" },
                        },
                      },
                    },
            ),
          ),
      ),
    );
    const owned = await refreshCall(bill.caseId, plan.id);
    expect(owned.record?.extracted).toEqual({ duplicate_tsh: "confirmed" });
    expect(owned.record?.transcript[0].message).toBe(
      "  Please send written confirmation.  ",
    );
    expect((await loadCase(bill.caseId))!.state.calls[0].conversationId).toBe(
      "conv_owned",
    );
  });
});
