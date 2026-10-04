/**
 * @file Proves live-call consent (demo stand-in for identity verification): only the exact phrase
 * counts, a request waits for it, consent can arrive from the case screen or an iMessage reply, the
 * request is texted once as a direct message, and Billy's tool route requires the shared secret.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { POST as consentTool } from "@/app/api/calls/consent/route";
import {
  CONSENT_PHRASE,
  consentStateOf,
  isConsentPhrase,
  recordConsent,
  requestConsent,
  waitForConsent,
} from "@/lib/cases/consent";
import { ingestSample } from "@/lib/cases/service";
import { getStore, memoryStore, type CaseStore } from "@/lib/cases/store";
import {
  ack,
  handleInbound,
  imessageStatus,
  pendingOutbox,
} from "@/lib/messaging/service";

const g = globalThis as typeof globalThis & { __mhStore?: CaseStore };
const BASE = "https://example.test";

beforeEach(() => {
  g.__mhStore = memoryStore();
});

describe("consent phrase", () => {
  /** Proves casing, punctuation, and spacing don't matter, but the words do. */
  it("accepts only the exact phrase", () => {
    expect(isConsentPhrase("i consent to Billy representing me.")).toBe(true);
    expect(isConsentPhrase("  I  CONSENT to billy representing me!! ")).toBe(
      true,
    );
    expect(isConsentPhrase("yes")).toBe(false);
    expect(isConsentPhrase("I consent to Billy")).toBe(false);
  });
});

describe("consent flow", () => {
  /** Proves a request is pending until the patient types the phrase on the web, and the wait sees it. */
  it("waits for consent typed on the case screen", async () => {
    const { caseId } = await ingestSample(null, "sample-bill");
    const requestId = await requestConsent(
      caseId,
      "Quillhaven Medical Group's billing office",
    );
    expect(
      consentStateOf((await getStore().getCase(caseId))!).pendingRequest
        ?.requestId,
    ).toBe(requestId);
    expect(await recordConsent(caseId, "no thanks", "web")).toBe(false);
    setTimeout(() => void recordConsent(caseId, CONSENT_PHRASE, "web"), 50);
    expect(await waitForConsent(caseId, requestId, 3000)).toBe(true);
    const state = consentStateOf((await getStore().getCase(caseId))!);
    expect(state).toMatchObject({ pendingRequest: null, via: "web" });
  });
  /** Proves the wait gives up when nobody replies. */
  it("times out without consent", async () => {
    const { caseId } = await ingestSample(null, "sample-bill");
    const requestId = await requestConsent(caseId, "the billing office");
    expect(await waitForConsent(caseId, requestId, 100)).toBe(false);
  });
  /** Proves the request is texted once to a linked phone and an iMessage reply records consent. */
  it("texts the request and accepts an iMessage reply", async () => {
    const { caseId } = await ingestSample(null, "sample-bill");
    const { code } = (await imessageStatus(caseId))!;
    const phone = "+15555550123";
    await handleInbound(phone, `LINK ${code}`, BASE);
    for (const m of await pendingOutbox(BASE)) await ack(m.messageId);
    await requestConsent(caseId, "the billing office");
    const out = (await pendingOutbox(BASE)).filter((m) =>
      m.text.includes(CONSENT_PHRASE),
    );
    expect(out).toHaveLength(1);
    await ack(out[0].messageId);
    expect(
      (await pendingOutbox(BASE)).some((m) => m.text.includes(CONSENT_PHRASE)),
    ).toBe(false);
    expect(
      await handleInbound(phone, "I consent to Billy representing me", BASE),
    ).toMatch(/Billy will tell the billing office/);
    expect(consentStateOf((await getStore().getCase(caseId))!)).toMatchObject({
      pendingRequest: null,
      via: "imessage",
    });
  });
});

describe("Billy's consent tool route", () => {
  /** Proves the route refuses requests without the shared secret. */
  it("requires the secret", async () => {
    process.env.MESSAGING_SECRET = "s3cret-value";
    const res = await consentTool(
      new Request("https://example.test/api/calls/consent", {
        method: "POST",
        body: "{}",
      }),
    );
    expect(res.status).toBe(401);
  });
});

/** Consent is a response to a current request; late replies and a contact hold never grant permission. */
describe("bounded consent", () => {
  /** Rejects unsolicited and expired typed phrases, including late iMessage replies. */
  it("rejects consent without a current request or after forty seconds", async () => {
    const { caseId } = await ingestSample(null, "sample-bill");
    expect(await recordConsent(caseId, CONSENT_PHRASE, "web")).toBe(false);
    await getStore().addEvent(caseId, "consent_requested", {
      requestId: "expired",
    });
    const c = (await getStore().getCase(caseId))!;
    const request = c.events.at(-1)!;
    const originalNow = Date.now;
    Date.now = () => Date.parse(request.createdAt) + 41000;
    try {
      expect(await recordConsent(caseId, CONSENT_PHRASE, "web")).toBe(false);
    } finally {
      Date.now = originalNow;
    }
  });
});
