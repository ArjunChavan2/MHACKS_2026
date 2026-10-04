/**
 * @file POST /api/calls/consent: ElevenLabs server tool "request_patient_consent" (demo).
 *
 * Called by Billy mid-call when the billing office needs to verify the patient. Opens a consent
 * request on the live case (texts the patient via iMessage when linked; the case screen shows a
 * consent box), waits up to ~40 s for the patient to type the exact phrase, and tells Billy whether
 * consent arrived. Authenticated with `x-billy-secret` = `MESSAGING_SECRET` (set on the tool).
 */
import { timingSafeEqual } from "node:crypto";
import { caseForActiveCall, requestConsent, waitForConsent } from "@/lib/cases/consent";

/** Long enough to wait for the patient's reply. */
export const maxDuration = 60;

/**
 * Constant-time check of the tool's shared secret.
 *
 * @param given - Header value.
 * @returns True when it matches `MESSAGING_SECRET`.
 */
function authorized(given: string | null): boolean {
  const secret = process.env.MESSAGING_SECRET;
  if (!secret || !given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Requests and waits for consent.
 *
 * @param req - ElevenLabs tool request (optional JSON `{ counterparty }`).
 * @returns `{ consented, message }` for Billy to act on.
 */
export async function POST(req: Request): Promise<Response> {
  if (!authorized(req.headers.get("x-billy-secret"))) return Response.json({ error: "unauthorized" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { counterparty?: string };
  const caseId = await caseForActiveCall();
  if (!caseId) return Response.json({ consented: false, message: "No active case found. Tell the office the patient will call back to verify." });
  const counterparty = (body.counterparty ?? "the billing office").slice(0, 120);
  const requestId = await requestConsent(caseId, counterparty);
  const consented = await waitForConsent(caseId, requestId);
  return Response.json(
    consented
      ? { consented: true, message: "The patient just confirmed in writing (by text) that they consent to Billy representing them on this account." }
      : { consented: false, message: "The patient has not replied yet. Tell the office the patient will verify directly and call back." },
  );
}
