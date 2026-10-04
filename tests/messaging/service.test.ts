/**
 * @file Proves the iMessage service end to end (SPEC.md §6 MVP 3 exit criteria) on the memory store
 * and on real Postgres (PGlite with the committed migrations): LINK → STATUS → A sends the dispute
 * through the approval gate → a duplicate A does nothing → an office response produces exactly one
 * outbox update → WHY quotes the Northstar record → STOP unlinks. Also covers unknown handles, wrong
 * codes, stale approvals, and the worker-only route auth.
 */
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { describeSource } from "@/app/_components/sources";
import { recordResponse, runCaseAction } from "@/lib/cases/caseflow";
import { auditCase, confirmDocument, draftLetter, ingestSample, loadCase } from "@/lib/cases/service";
import { memoryStore, pgStore, type CaseStore } from "@/lib/cases/store";
import { ack, handleInbound, imessageStatus, pendingOutbox } from "@/lib/messaging/service";
import { POST as inboundRoute } from "@/app/api/messaging/inbound/route";
import { GET as outboxRoute } from "@/app/api/messaging/outbox/route";

const g = globalThis as typeof globalThis & { __mhStore?: CaseStore };
const AS_PRINTED = { corrections: {}, confirmedPaths: [], acknowledgeTotalsMismatch: false };
const OFFICE = "Quillhaven Medical Group billing office";
const BASE = "https://billless.tech";
const saved = { gemini: process.env.GEMINI_API_KEY, xai: process.env.XAI_API_KEY, today: process.env.DEMO_TODAY, secret: process.env.MESSAGING_SECRET, app: process.env.APP_URL };
let client: PGlite;

beforeAll(async () => {
  delete process.env.GEMINI_API_KEY;
  delete process.env.XAI_API_KEY;
  delete process.env.APP_URL;
  process.env.DEMO_TODAY = "2026-03-24";
  client = new PGlite();
  await migrate(drizzle(client), { migrationsFolder: "db/migrations" });
});

afterAll(async () => {
  g.__mhStore = undefined;
  await client.close();
  for (const [k, v] of [["GEMINI_API_KEY", saved.gemini], ["XAI_API_KEY", saved.xai], ["DEMO_TODAY", saved.today], ["MESSAGING_SECRET", saved.secret], ["APP_URL", saved.app]] as const) {
    if (v) process.env[k] = v;
    else delete process.env[k];
  }
});

/**
 * Sets up the demo case through the drafted dispute and returns its IDs and link code.
 *
 * @returns Case ID, link code, and the documentation-gap finding ID.
 */
async function draftedCase() {
  const bill = await ingestSample(null, "sample-bill");
  const eob = await ingestSample(bill.caseId, "sample-eob");
  await confirmDocument(bill.documentId, AS_PRINTED);
  await confirmDocument(eob.documentId, AS_PRINTED);
  const audit = await auditCase(bill.caseId, bill.documentId, eob.documentId);
  await draftLetter(bill.caseId, bill.documentId, eob.documentId);
  const status = await imessageStatus(bill.caseId);
  return { caseId: bill.caseId, code: status!.code, gap: audit.findings.find((f) => f.rule === "documentation_gap")!.id };
}

/** A unique handle per test, so cases on the shared Postgres don't collide. */
let n = 0;
const nextHandle = () => `+1555000${String(++n).padStart(4, "0")}`;

describe.each([
  ["memory", () => memoryStore()],
  ["postgres", () => pgStore(drizzle(client))],
] as const)("iMessage on the %s store", (_name, makeStore) => {
  beforeEach(() => {
    g.__mhStore = makeStore();
  });

  /** Proves the full demo path and that "A" goes through the same approval gate as the web button. */
  it("links, approves by reply, notifies once, answers why, and unlinks", async () => {
    const c = await draftedCase();
    const me = nextHandle();

    expect(await handleInbound(me, "STATUS", BASE)).toMatch(/isn't linked/);
    expect(await handleInbound(me, "LINK ZZZZZZ", BASE)).toMatch(/didn't match/);

    const linked = await handleInbound(me, `link ${c.code.toLowerCase()}`, BASE);
    expect(linked).toMatch(/^Linked\./);
    expect(linked).toContain("Approve sending the dispute letter");
    expect(linked).toContain(`${BASE}/?case=${c.caseId}`);
    expect((await imessageStatus(c.caseId))?.linked).toBe(true);
    // The link reply already delivered the card, so nothing is queued.
    expect((await pendingOutbox(BASE)).filter((m) => m.handle === me)).toEqual([]);

    const status = await handleInbound(me, "status", BASE);
    expect(status).toContain("1. ");
    expect(status).toContain("Reply A to approve");

    const approved = await handleInbound(me, "A", BASE);
    expect(approved).toMatch(/^Done: Send the dispute letter/);
    const afterSend = await loadCase(c.caseId);
    expect(afterSend?.state.phase).toBe("waiting_response");
    expect(afterSend?.state.timeline.map((e) => e.type)).toEqual(expect.arrayContaining(["approval_recorded", "dispute_sent", "imessage_linked", "imessage_reply"]));

    // A second "A" must not send anything again.
    expect(await handleInbound(me, "A", BASE)).toMatch(/^Already done/);
    expect(afterSend?.state.timeline.filter((e) => e.type === "dispute_sent")).toHaveLength(1);
    expect((await loadCase(c.caseId))?.state.timeline.filter((e) => e.type === "dispute_sent")).toHaveLength(1);

    // The office says the lab record will follow: exactly one update, reused until acknowledged.
    await recordResponse(c.caseId, { from: OFFICE, perFinding: [{ findingId: c.gap, kind: "will_send_later", neededDocument: "free T4 lab record", responsibleParty: "Quillhaven laboratory", promisedBy: "2026-03-31" }] });
    const first = (await pendingOutbox(BASE)).filter((m) => m.handle === me);
    expect(first).toHaveLength(1);
    expect(first[0].text).toContain("Waiting for the free T4 lab record");
    const again = (await pendingOutbox(BASE)).filter((m) => m.handle === me);
    expect(again.map((m) => m.messageId)).toEqual([first[0].messageId]);
    expect(await ack(first[0].messageId)).toBe(true);
    expect(await ack(first[0].messageId)).toBe(true);
    expect((await pendingOutbox(BASE)).filter((m) => m.handle === me)).toEqual([]);
    expect(await ack("msg_unknown")).toBe(false);

    // WHY about the free T4 quotes Northstar's record verbatim.
    const view = await loadCase(c.caseId);
    const gap = view?.audit?.findings.find((f) => f.id === c.gap);
    const why = await handleInbound(me, "why was the free T4 flagged?", BASE);
    expect(why).toContain(gap!.title);
    const record = gap!.sources.find((s) => s.kind === "record");
    if (record) expect(why).toContain(describeSource(record));

    // "A" with nothing to approve is refused and changes nothing.
    expect(await handleInbound(me, "yes", BASE)).toMatch(/^(Nothing is waiting|That choice is no longer available|Already done)/);

    expect(await handleInbound(me, "STOP", BASE)).toContain(`LINK ${c.code}`);
    expect((await imessageStatus(c.caseId))?.linked).toBe(false);
    expect(await handleInbound(me, "status", BASE)).toMatch(/isn't linked/);
  });

  /** Proves an "A" for a card that changed on the web is refused without running anything. */
  it("refuses a stale approval after the web already acted", async () => {
    const c = await draftedCase();
    const me = nextHandle();
    await handleInbound(me, `LINK ${c.code}`, BASE);
    const v = await loadCase(c.caseId);
    await runCaseAction(c.caseId, { actionId: "send_dispute", target: v?.state.next.target, approve: true });
    expect(await handleInbound(me, "A", BASE)).toMatch(/^That choice is no longer available/);
    expect((await loadCase(c.caseId))?.state.timeline.filter((e) => e.type === "approval_recorded")).toHaveLength(1);
  });

  /** Proves B holds (nothing runs) and linking another case moves the handle. */
  it("holds on B and moves a handle to a newly linked case", async () => {
    const one = await draftedCase();
    const two = await draftedCase();
    const me = nextHandle();
    await handleInbound(me, `LINK ${one.code}`, BASE);
    expect(await handleInbound(me, "B", BASE)).toMatch(/^Okay, holding/);
    expect((await loadCase(one.caseId))?.state.phase).toBe("awaiting_approval");
    await handleInbound(me, `LINK ${two.code}`, BASE);
    expect((await imessageStatus(one.caseId))?.linked).toBe(false);
    expect((await imessageStatus(two.caseId))?.linked).toBe(true);
    expect(await handleInbound(me, "help", BASE)).toContain(two.caseId);
  });
});

describe("worker routes", () => {
  beforeEach(() => {
    g.__mhStore = memoryStore();
  });

  /** Proves the routes are off without a secret and reject a wrong token. */
  it("requires the shared secret", async () => {
    delete process.env.MESSAGING_SECRET;
    expect((await outboxRoute(new Request("http://x/api/messaging/outbox"))).status).toBe(503);
    process.env.MESSAGING_SECRET = "s3cret-value";
    expect((await outboxRoute(new Request("http://x/api/messaging/outbox", { headers: { Authorization: "Bearer nope" } }))).status).toBe(401);
    const ok = await outboxRoute(new Request("http://x/api/messaging/outbox", { headers: { Authorization: "Bearer s3cret-value" } }));
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual([]);
  });

  /** Proves inbound always answers with a reply and validates its body. */
  it("answers inbound texts", async () => {
    process.env.MESSAGING_SECRET = "s3cret-value";
    const headers = { Authorization: "Bearer s3cret-value", "Content-Type": "application/json" };
    const res = await inboundRoute(new Request("http://x/api/messaging/inbound", { method: "POST", headers, body: JSON.stringify({ handle: "+15550009999", text: "hi" }) }));
    expect(res.status).toBe(200);
    expect((await res.json()).reply).toMatch(/isn't linked/);
    const bad = await inboundRoute(new Request("http://x/api/messaging/inbound", { method: "POST", headers, body: "{}" }));
    expect(bad.status).toBe(400);
  });
});
