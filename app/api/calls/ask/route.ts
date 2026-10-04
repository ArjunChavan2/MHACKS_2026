/**
 * @file POST /api/calls/ask: ElevenLabs server tool "ask_patient" (MVP 4).
 *
 * Called by Billy mid-call when the office asks for a detail Billy doesn't have (date of birth,
 * member ID, address…). Texts the patient the question through Photon, waits up to ~40 s, and returns
 * the patient's reply verbatim, or that nothing may be shared. Questions about SSNs, card or bank
 * numbers, passwords, or PINs are refused before anything is texted (`lib/cases/patientQuestions.ts`).
 * Authenticated with `x-billy-secret` = `MESSAGING_SECRET` (set on the tool, like the consent tool).
 */
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { caseForLiveCall } from "@/lib/cases/consent";
import { askPatient, blockedTopic, waitForAnswer } from "@/lib/cases/patientQuestions";
import { getStore } from "@/lib/cases/store";
import { activeHandles } from "@/lib/messaging/service";

/** Long enough to wait for the patient's reply. */
export const maxDuration = 60;

/** Tool parameters Billy sends. */
const AskSchema = z.object({
  question: z.string().trim().min(3).max(500),
  counterparty: z.string().trim().max(120).optional(),
});

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
 * Asks the patient and waits for the answer.
 *
 * @param req - ElevenLabs tool request with JSON `{ question, counterparty? }`.
 * @returns `{ answered, answer?, message }` for Billy to act on; 400 for a bad body, 401 without the secret.
 */
export async function POST(req: Request): Promise<Response> {
  if (!authorized(req.headers.get("x-billy-secret"))) return Response.json({ error: "unauthorized" }, { status: 401 });
  const parsed = AskSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "bad_request", message: "Send { question, counterparty? }." }, { status: 400 });
  const { question } = parsed.data;
  const counterparty = parsed.data.counterparty || "the billing office";

  const blocked = blockedTopic(question);
  if (blocked) {
    return Response.json({ answered: false, message: `Never collected by text: ${blocked}. Tell them the patient will provide it directly, and continue with anything else.` });
  }
  const caseId = await caseForLiveCall();
  const c = caseId ? await getStore().getCase(caseId) : null;
  if (!caseId || !c) return Response.json({ answered: false, message: "No active case. Tell them the patient will provide it directly." });
  if (!activeHandles(c).length) {
    return Response.json({ answered: false, message: "The patient can't be reached by text right now. Tell them the patient will provide it directly." });
  }

  const questionId = await askPatient(caseId, question, counterparty);
  const outcome = await waitForAnswer(caseId, questionId);
  switch (outcome.status) {
    case "answered":
      return Response.json({ answered: true, answer: outcome.answer, message: `The patient replied by text. Read their answer to them exactly as written, without changing or adding anything: "${outcome.answer}"` });
    case "skipped":
      return Response.json({ answered: false, message: "The patient chose not to share that. Tell them the patient will provide it directly if needed." });
    case "withheld":
      return Response.json({ answered: false, message: "The patient's reply can't be shared by text. Tell them the patient will provide it directly." });
    case "timeout":
      return Response.json({ answered: false, message: "The patient hasn't replied yet. Tell them the patient will provide it directly and call back." });
  }
}
