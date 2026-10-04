/**
 * @file Proves Billy's ask-the-patient-by-text flow (MVP 4): blocked topics are never texted, replies
 * that look like an SSN or card number are withheld, SKIP shares nothing, late replies aren't shared,
 * the patient's next text answers an open question (even "yes"), and `/api/calls/ask` returns the
 * patient's reply verbatim end to end on the memory store.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { POST as askRoute } from "@/app/api/calls/ask/route";
import { askPatient, blockedTopic, cleanQuestion, looksSensitive, openQuestionOf } from "@/lib/cases/patientQuestions";
import { auditCase, confirmDocument, ingestSample } from "@/lib/cases/service";
import { getStore, memoryStore, type CaseStore } from "@/lib/cases/store";
import { handleInbound, imessageStatus } from "@/lib/messaging/service";

const g = globalThis as typeof globalThis & { __mhStore?: CaseStore };
const AS_PRINTED = { corrections: {}, confirmedPaths: [], acknowledgeTotalsMismatch: false };
const BASE = "https://billless.tech";
const PHONE = "+15550004242";
const OFFICE = "Quillhaven Medical Group's billing office";
const keys = ["GEMINI_API_KEY", "XAI_API_KEY", "MESSAGING_SECRET", "DEMO_CASE_ID"] as const;
const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));

beforeAll(() => {
  delete process.env.GEMINI_API_KEY;
  delete process.env.XAI_API_KEY;
  process.env.MESSAGING_SECRET = "test-secret";
});

afterAll(() => {
  g.__mhStore = undefined;
  for (const k of keys) {
    if (saved[k]) process.env[k] = saved[k];
    else delete process.env[k];
  }
});

beforeEach(() => {
  g.__mhStore = memoryStore();
});

/**
 * Builds the audited demo case with the demo phone linked, and makes it the live call's case.
 *
 * @returns Case ID.
 */
async function linkedCase(): Promise<string> {
  const bill = await ingestSample(null, "sample-bill");
  const eob = await ingestSample(bill.caseId, "sample-eob");
  await confirmDocument(bill.documentId, AS_PRINTED);
  await confirmDocument(eob.documentId, AS_PRINTED);
  await auditCase(bill.caseId, bill.documentId, eob.documentId);
  const code = (await imessageStatus(bill.caseId))!.code;
  await handleInbound(PHONE, `LINK ${code}`, BASE);
  process.env.DEMO_CASE_ID = bill.caseId;
  return bill.caseId;
}

/**
 * Calls the tool route as ElevenLabs would.
 *
 * @param body - Tool parameters.
 * @param secret - `x-billy-secret` header value.
 * @returns The route's response.
 */
function callAsk(body: unknown, secret = "test-secret"): Promise<Response> {
  return askRoute(new Request("http://x/api/calls/ask", { method: "POST", headers: { "x-billy-secret": secret, "Content-Type": "application/json" }, body: JSON.stringify(body) }));
}

/**
 * Waits until the case has an open question (the route opens it asynchronously).
 *
 * @param caseId - Case ID.
 */
async function untilAsked(caseId: string): Promise<void> {
  for (let i = 0; i < 100; i++) {
    const c = await getStore().getCase(caseId);
    if (c && openQuestionOf(c)) return;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error("question never opened");
}

describe("checks", () => {
  /** Proves SSN, card, bank, and password questions are refused and ordinary ones pass. */
  it.each([
    ["What's the last four of her social security number?", "a Social Security number"],
    ["Can I get the SSN on file?", "a Social Security number"],
    ["What card number would she like to use?", "payment card details"],
    ["And the CVV?", "payment card details"],
    ["Routing number for autopay?", "bank account details"],
    ["What's her portal password?", "a password or PIN"],
    ["What's the patient's date of birth?", null],
    ["Can you confirm her member ID?", null],
    ["What's the mailing address on file?", null],
  ])("blockedTopic(%j)", (q, label) => {
    expect(blockedTopic(q)).toBe(label);
  });

  /** Proves SSN- and card-like replies are caught while dates, IDs, phones, and ZIPs pass. */
  it.each([
    ["123-45-6789", true],
    ["123456789", true],
    ["4111 1111 1111 1111", true],
    ["March 14, 1988", false],
    ["03/14/1988", false],
    ["WMH884213", false],
    ["(734) 555-0101", false],
    ["48104", false],
  ])("looksSensitive(%j)", (a, sensitive) => {
    expect(looksSensitive(a)).toBe(sensitive);
  });

  /** Proves questions are one short line without wrapping quotes. */
  it("cleans questions", () => {
    expect(cleanQuestion('  "What is her\n date of birth?"  ')).toBe("What is her date of birth?");
    expect(cleanQuestion("x".repeat(300))).toHaveLength(200);
  });
});

describe("answers by text", () => {
  /** Proves the next text answers the open question, even a command word like "yes". */
  it("captures the next text as the answer", async () => {
    const caseId = await linkedCase();
    await askPatient(caseId, "Is the address on file still current?", OFFICE);
    const c = await getStore().getCase(caseId);
    const direct = c!.events.filter((e) => e.type === "imessage_direct").at(-1)!.data as { text: string };
    expect(direct.text).toContain("“Is the address on file still current?”");
    expect(direct.text).toContain("SKIP → Don't share it");
    expect(await handleInbound(PHONE, "yes", BASE)).toBe(`Thanks. Billy will tell ${OFFICE}: “yes”`);
    expect(openQuestionOf((await getStore().getCase(caseId))!)).toBeNull();
    // With the question answered, "yes" is an ordinary command again.
    expect(await handleInbound(PHONE, "yes", BASE)).not.toContain("Billy will tell");
  });

  /** Proves SKIP and sensitive-looking replies share nothing, and STOP still unlinks. */
  it("shares nothing on SKIP or a sensitive-looking reply", async () => {
    const caseId = await linkedCase();
    await askPatient(caseId, "What's the member ID?", OFFICE);
    expect(await handleInbound(PHONE, "skip", BASE)).toMatch(/won't share/);
    await askPatient(caseId, "What's the member ID?", OFFICE);
    expect(await handleInbound(PHONE, "123-45-6789", BASE)).toMatch(/won't share it/);
    const answered = (await getStore().getCase(caseId))!.events.filter((e) => e.type === "patient_question_answered").map((e) => e.data);
    expect(answered).toEqual([expect.objectContaining({ outcome: "skipped" }), expect.objectContaining({ outcome: "withheld" })]);
    expect(JSON.stringify(answered)).not.toContain("6789");
    await askPatient(caseId, "What's the member ID?", OFFICE);
    expect(await handleInbound(PHONE, "STOP", BASE)).toMatch(/won't get more texts/);
  });
});

describe("POST /api/calls/ask", () => {
  /** Proves the full tool round trip returns the patient's reply verbatim. */
  it("returns the patient's answer verbatim", async () => {
    const caseId = await linkedCase();
    const pending = callAsk({ question: "What's the patient's date of birth?", counterparty: OFFICE });
    await untilAsked(caseId);
    await handleInbound(PHONE, "March 14, 1988", BASE);
    const body = await (await pending).json();
    expect(body).toMatchObject({ answered: true, answer: "March 14, 1988" });
    expect(body.message).toContain('"March 14, 1988"');
  });

  /** Proves blocked questions are refused without texting the patient. */
  it("refuses blocked topics without texting", async () => {
    const caseId = await linkedCase();
    const body = await (await callAsk({ question: "Last four of her SSN?" })).json();
    expect(body.answered).toBe(false);
    expect(body.message).toContain("Never collected by text");
    expect((await getStore().getCase(caseId))!.events.some((e) => e.type === "patient_question_asked")).toBe(false);
  });

  /** Proves an unlinked patient gets an immediate "can't be reached" instead of a 40 s wait. */
  it("answers at once when no phone is linked", async () => {
    const caseId = await linkedCase();
    await handleInbound(PHONE, "STOP", BASE);
    const body = await (await callAsk({ question: "Date of birth?" })).json();
    expect(body).toMatchObject({ answered: false });
    expect(body.message).toContain("can't be reached by text");
    expect((await getStore().getCase(caseId))!.events.some((e) => e.type === "patient_question_asked")).toBe(false);
  });

  /** Proves the shared secret and body are checked. */
  it("checks the secret and body", async () => {
    await linkedCase();
    expect((await callAsk({ question: "Date of birth?" }, "wrong")).status).toBe(401);
    expect((await callAsk({ nope: true })).status).toBe(400);
  });
});
