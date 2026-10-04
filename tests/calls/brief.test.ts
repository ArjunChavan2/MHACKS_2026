/**
 * @file Proves Billy's per-call brief follows the live case: a billing-error case briefs a billing
 * office call with that patient's details, an insurer-only case briefs an insurer call, the brief
 * route requires the shared secret, and with no case Billy gets a no-details brief (never another
 * patient's). The case is the one that last pressed "Get Billy ready"; a running call stays on its case.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { POST as briefRoute } from "@/app/api/calls/brief/route";
import {
  findBillExceedsEob,
  findDuplicateCharges,
  findInsurerDenials,
} from "@/lib/audit/rules";
import { buildCallBrief } from "@/lib/calls/brief";
import { ACTIVE_CALL_MS, caseForActiveCall, caseForLiveCall } from "@/lib/cases/consent";
import { memoryStore, type CaseStore } from "@/lib/cases/store";
import type { ConfirmedBill, ConfirmedEob } from "@/lib/types";
import { confirmedSampleBill, confirmedSampleEob } from "../helpers";

const g = globalThis as typeof globalThis & { __mhStore?: CaseStore };
const SECRET = "brief-s3cret";

beforeEach(() => {
  g.__mhStore = memoryStore();
  process.env.MESSAGING_SECRET = SECRET;
  delete process.env.DEMO_CASE_ID;
  delete process.env.CALL_WORKSPACE_ENABLED;
});

/** A second synthetic patient whose only issue is an insurer denial. */
async function marcus(): Promise<{ bill: ConfirmedBill; eob: ConfirmedEob }> {
  const bill = {
    ...(await confirmedSampleBill()),
    patientName: "Marcus Reyes Test",
  };
  const eob = await confirmedSampleEob();
  const denied: ConfirmedEob = {
    ...eob,
    lines: eob.lines.map((l, i) =>
      i === 3
        ? {
            ...l,
            allowedCents: 0,
            planPaidCents: 0,
            patientResponsibilityCents: l.billedCents,
          }
        : l,
    ),
  };
  return { bill, eob: denied };
}

/** Calls the brief route like ElevenLabs does. */
function call(secret: string | null, body: object = {}): Promise<Response> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (secret) headers["x-billy-secret"] = secret;
  return briefRoute(
    new Request("https://example.test/api/calls/brief", {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    }),
  );
}

describe("buildCallBrief", () => {
  /** Proves billing errors brief a billing-office call with the bill's patient and provider. */
  it("briefs the billing office for billing errors", async () => {
    const bill = await confirmedSampleBill();
    const eob = await confirmedSampleEob();
    const brief = buildCallBrief(bill, eob, [
      ...findDuplicateCharges(bill),
      ...findBillExceedsEob(bill, eob),
    ])!;
    expect(brief.mode).toBe("billing");
    expect(brief.firstMessage).toMatch(/billing office/);
    expect(brief.prompt).toContain(bill.patientName!);
    expect(brief.prompt).toContain(bill.billingEntity);
  });
  /** Proves the call rules: consent first, say so before texting the patient, plain digits. */
  it("asks consent first, announces texts, and says digits plainly", async () => {
    const bill = await confirmedSampleBill();
    const brief = buildCallBrief(bill, null, findDuplicateCharges(bill))!;
    expect(brief.prompt).toMatch(/CONSENT FIRST \(start of every call\)/);
    expect(brief.prompt).toMatch(/Never use those tools silently/);
    expect(brief.prompt).toMatch(/Never add "as in" to a digit/);
    expect(brief.prompt.indexOf("CONSENT FIRST")).toBeLessThan(brief.prompt.indexOf("WHAT TO ASK FOR"));
  });
  /** Proves an insurer-only case briefs an insurer call with that patient's name, never "billing office". */
  it("briefs the insurer when every issue is the insurer's", async () => {
    const { bill, eob } = await marcus();
    const brief = buildCallBrief(bill, eob, findInsurerDenials(bill, eob))!;
    expect(brief.mode).toBe("insurer");
    expect(brief.firstMessage).toContain("Marcus Reyes Test");
    expect(brief.firstMessage).toContain(eob.insurer!);
    expect(brief.firstMessage).not.toMatch(/billing office/);
    expect(brief.prompt).toContain("calling the INSURER");
  });
  /** Patient exclusions must never appear in the call prompt or generate a call on their own. */
  it("skips issues the patient excluded", async () => {
    const bill = await confirmedSampleBill();
    const eob = await confirmedSampleEob();
    const excluded = findDuplicateCharges(bill).map((f) => ({
      ...f,
      patientExcluded: true,
    }));
    expect(buildCallBrief(bill, eob, excluded)).toBeNull();
    const selected = findBillExceedsEob(bill, eob);
    const brief = buildCallBrief(bill, eob, [...excluded, ...selected])!;
    for (const finding of excluded)
      expect(brief.prompt).not.toContain(finding.letterText);
  });
  /** Proves there is no brief when nothing is open. */
  it("returns null with no open findings", async () => {
    expect(buildCallBrief(await confirmedSampleBill(), null, [])).toBeNull();
  });
});

describe("brief route", () => {
  /** Proves the route refuses calls without the shared secret. */
  it("requires the secret", async () => {
    expect((await call(null)).status).toBe(401);
    expect((await call("wrong")).status).toBe(401);
  });
  /** Proves with no case Billy gets a no-details brief that forbids inventing anything. */
  it("gives a no-details brief without a case", async () => {
    const res = await call(SECRET, { agent_id: "agent_x" });
    const body = (await res.json()) as {
      type: string;
      conversation_config_override: { agent: { prompt: { prompt: string } } };
    };
    expect(body.type).toBe("conversation_initiation_client_data");
    expect(body.conversation_config_override.agent.prompt.prompt).toMatch(
      /Never make up/,
    );
  });
  /** Proves the brief comes from the most recently active case. */
  it("briefs the latest case", async () => {
    const store = g.__mhStore!;
    const { bill, eob } = await marcus();
    const caseId = await store.createCase(null);
    for (const [docType, confirmed] of [
      ["itemized_bill", bill],
      ["eob", eob],
    ] as const) {
      await store.saveDocument({
        id: `doc_${docType}`,
        caseId,
        docType,
        direction: "incoming",
        status: "confirmed",
        fileName: null,
        storageKey: null,
        extraction: null,
        extractionMeta: null,
        confirmed,
        draft: null,
      });
    }
    await store.saveFindings(caseId, findInsurerDenials(bill, eob));
    await store.addEvent(caseId, "audited", {});
    const body = (await (
      await call(SECRET, { agent_id: "agent_x" })
    ).json()) as {
      conversation_config_override: { agent: { first_message: string } };
    };
    expect(body.conversation_config_override.agent.first_message).toContain(
      "Marcus Reyes Test",
    );
    expect(body.conversation_config_override.agent.first_message).not.toMatch(
      /billing office/,
    );
  });
  /** Proves an enabled workspace cannot disclose the latest case for an unrecognized call. */
  it("fails closed for an unknown workspace call", async () => {
    process.env.CALL_WORKSPACE_ENABLED = "true";
    const body = await (
      await call(SECRET, { call_sid: `CA${"a".repeat(32)}` })
    ).json();
    expect(body.dynamic_variables).toEqual({});
    expect(body.conversation_config_override.agent.prompt.prompt).toContain(
      "Never make up",
    );
  });
});

describe("which case a call is about", () => {
  /** Proves "Get Billy ready" pins the next call to that case even when someone else uses the site after. */
  it("prefers the armed case over later activity elsewhere", async () => {
    const store = g.__mhStore!;
    const marcusCase = await store.createCase(null);
    const priyaCase = await store.createCase(null);
    await store.addEvent(marcusCase, "call_armed", {});
    await store.addEvent(priyaCase, "audit_run", {});
    expect(await caseForLiveCall()).toBe(marcusCase);
  });
  /** Proves a call in progress stays on the case it was briefed for, and expires after the call cap. */
  it("keeps a running call on its briefed case", async () => {
    const store = g.__mhStore!;
    const a = await store.createCase(null);
    const b = await store.createCase(null);
    await store.addEvent(a, "call_briefed", { mode: "insurer" });
    await store.addEvent(b, "call_armed", {});
    expect(await caseForActiveCall()).toBe(a);
    expect(await caseForActiveCall(Date.now() + ACTIVE_CALL_MS + 1000)).toBe(b);
  });
});
