/**
 * @file Patient consent for Billy to represent them on a live call (demo stand-in for identity
 * verification; SPEC.md §4.7). When the billing office asks to verify the patient, Billy asks our
 * app for consent; the patient is texted by iMessage (Photon) and must reply there; the website
 * cannot record consent. Consent counts only when the patient types the exact phrase. Stored as case events.
 *
 * DEMO ONLY: typed consent is not identity verification; real offices may still require the patient
 * on the line or a signed authorization form.
 */
import { preferencesOf } from "./preferences";
import { newId, getStore, type StoredCase } from "./store";

/** The exact phrase the patient must type. */
export const CONSENT_PHRASE = "I consent to Billy representing me";

/** How long Billy's tool waits for consent before telling the office the patient will call back. */
export const CONSENT_WAIT_MS = 40_000;

/** How often to check for consent while waiting. */
const POLL_MS = 1500;

/**
 * Normalizes text for comparing with the consent phrase (case, punctuation, spacing).
 *
 * @param s - Text.
 * @returns Normalized text.
 */
function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Whether a message is the consent phrase (ignoring case, punctuation, and spacing).
 *
 * @param text - Message from the patient.
 * @returns True only for the exact phrase.
 */
export function isConsentPhrase(text: string): boolean {
  return norm(text) === norm(CONSENT_PHRASE);
}

/** Consent state of a case, for the case screen. */
export interface ConsentState {
  /** An open request (no consent after it yet), or null. */
  pendingRequest: { requestId: string; at: string; expired: boolean } | null;
  /** When consent was last given, or null. */
  givenAt: string | null;
  via: "imessage" | null;
}

/**
 * Reads the consent state from a case's events.
 *
 * @param c - Stored case.
 * @returns The consent state.
 */
export function consentStateOf(c: StoredCase): ConsentState {
  const requests = c.events.filter((e) => e.type === "consent_requested");
  const given = c.events.filter(
    (e) =>
      e.type === "consent_given" &&
      (e.data as { via?: string }).via === "imessage",
  );
  const lastReq = requests.at(-1);
  const lastGiven = given.at(-1);
  const matchingGiven =
    lastReq &&
    given.some(
      (event) =>
        (event.data as { requestId?: string }).requestId ===
          (lastReq.data as { requestId: string }).requestId ||
        (!(event.data as { requestId?: string }).requestId &&
          event.createdAt >= lastReq.createdAt),
    );
  const pending =
    lastReq && !matchingGiven
      ? {
          requestId: (lastReq.data as { requestId: string }).requestId,
          at: lastReq.createdAt,
          expired:
            Date.now() >= Date.parse(lastReq.createdAt) + CONSENT_WAIT_MS,
        }
      : null;
  return {
    pendingRequest: pending,
    givenAt: lastGiven?.createdAt ?? null,
    via: (lastGiven?.data as { via?: "imessage" } | undefined)?.via ?? null,
  };
}

/**
 * Opens a consent request: records it and queues a direct iMessage to the linked patient phone.
 *
 * @param caseId - Case ID.
 * @param counterparty - Who is asking (e.g. "Quillhaven Medical Group's billing office").
 * @returns The request ID.
 */
export async function requestConsent(
  caseId: string,
  counterparty: string,
): Promise<string> {
  const store = getStore();
  const c = await store.getCase(caseId);
  if (!c || preferencesOf(c).pauseContact)
    throw new Error("Contact is on hold or the case is unavailable.");
  const requestId = newId("cns");
  await store.addEvent(caseId, "consent_requested", {
    requestId,
    counterparty,
  });
  await store.addEvent(caseId, "imessage_direct", {
    messageId: newId("msg"),
    text: `Billy is on a call with ${counterparty} about your bill. To let Billy represent you, reply exactly:\n${CONSENT_PHRASE}`,
  });
  return requestId;
}

/**
 * Records the patient's consent if the text is the exact phrase.
 *
 * @param caseId - Case ID.
 * @param text - What the patient typed.
 * @param via - Where it came from.
 * @returns True when recorded; false when the text isn't the phrase.
 */
export async function recordConsent(
  caseId: string,
  text: string,
  via: "imessage",
): Promise<boolean> {
  if (via !== "imessage" || !isConsentPhrase(text)) return false;
  const store = getStore();
  const c = await store.getCase(caseId);
  const pending = c ? consentStateOf(c).pendingRequest : null;
  if (
    !c ||
    !pending ||
    preferencesOf(c).pauseContact ||
    Date.now() >= Date.parse(pending.at) + CONSENT_WAIT_MS
  )
    return false;
  await store.addEvent(caseId, "consent_given", {
    via,
    phrase: CONSENT_PHRASE,
    requestId: pending.requestId,
  });
  return true;
}

/**
 * Waits for consent given after a request.
 *
 * Side effects: polls the store.
 *
 * @param caseId - Case ID.
 * @param requestId - The request being answered.
 * @param timeoutMs - How long to wait.
 * @returns True if consent arrived in time.
 */
export async function waitForConsent(
  caseId: string,
  requestId: string,
  timeoutMs = CONSENT_WAIT_MS,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const c = await getStore().getCase(caseId);
    const req = c?.events.find(
      (e) =>
        e.type === "consent_requested" &&
        (e.data as { requestId?: string }).requestId === requestId,
    );
    if (c && preferencesOf(c).pauseContact) return false;
    if (
      c &&
      req &&
      c.events.some(
        (e) =>
          e.type === "consent_given" &&
          (e.data as { requestId?: string }).requestId === requestId &&
          e.createdAt >= req.createdAt &&
          Date.parse(e.createdAt) < Date.parse(req.createdAt) + CONSENT_WAIT_MS,
      )
    )
      return true;
    if (Date.now() >= deadline) return false;
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}

/** How long a started call stays tied to the case it was briefed for (calls are capped at 30 min). */
export const ACTIVE_CALL_MS = 35 * 60_000;

/**
 * Picks the case a new call is about. Inbound calls carry no case ID, so the patient picks it: the case
 * whose screen last pressed "Get Billy ready" (`call_armed`). `DEMO_CASE_ID` overrides; with no armed
 * case ever, falls back to the most recent activity. Other people using the site don't move it.
 *
 * @returns Case ID, or null when there is no candidate.
 */
export async function caseForLiveCall(): Promise<string | null> {
  if (process.env.DEMO_CASE_ID) return process.env.DEMO_CASE_ID;
  const store = getStore();
  return (await store.latestEventOf("call_armed"))?.caseId ?? store.latestCaseId();
}

/**
 * Picks the case of the call in progress (for Billy's tools mid-call): the case the latest call was
 * briefed for, if that was within `ACTIVE_CALL_MS`; otherwise `caseForLiveCall`.
 *
 * @param now - Current time (ms), for tests.
 * @returns Case ID, or null.
 */
export async function caseForActiveCall(now = Date.now()): Promise<string | null> {
  if (process.env.DEMO_CASE_ID) return process.env.DEMO_CASE_ID;
  const briefed = await getStore().latestEventOf("call_briefed");
  if (briefed && now - Date.parse(briefed.createdAt) < ACTIVE_CALL_MS) return briefed.caseId;
  return caseForLiveCall();
}
