/**
 * @file Questions Billy asks the patient by text during a live call (MVP 4, SPEC.md §4.7, §4.9).
 *
 * When the office asks for a detail Billy doesn't have (date of birth, member ID, address…), Billy's
 * ElevenLabs tool `ask_patient` calls `/api/calls/ask`, which opens a question here and texts the
 * patient through Photon. The patient's next text answers it; replying SKIP means "don't share".
 * Billy may then read the patient's reply to the office exactly as written.
 *
 * Rules enforced in code, not left to the voice model:
 * - The patient decides (SPEC.md §2 rule 5): nothing is shared unless the patient replies, and the
 *   reply is returned verbatim; a timeout or SKIP means nothing is shared.
 * - Never collected by text: any part of a Social Security number, payment card or bank numbers,
 *   passwords, PINs, or security codes. Questions about them are refused before anything is sent, and
 *   replies that look like them are withheld from Billy.
 * - The question text comes from Billy (an LLM) but carries no health fact: it is wrapped in fixed
 *   wording, shown in quotes, and limited to one short line.
 *
 * State lives as case events: `patient_question_asked`, `patient_question_answered`. Neither holds a
 * handle (handles stay only in link events).
 */
import { getStore, newId, type StoredCase } from "./store";

/** How long the tool waits for the patient's reply (ElevenLabs tool calls must return within ~60 s). */
export const QUESTION_WAIT_MS = 40_000;

/** After this, an unanswered question no longer captures the patient's next text. */
export const QUESTION_OPEN_MS = 2 * 60_000;

/** Longest question we text. */
const MAX_QUESTION_CHARS = 200;

/** Longest answer we pass to Billy. */
const MAX_ANSWER_CHARS = 200;

/** How often to check for the reply while waiting. */
const POLL_MS = 1500;

/** Topics never asked about or relayed by text. */
const BLOCKED_TOPICS: ReadonlyArray<{ re: RegExp; label: string }> = [
  { re: /\b(ssn|social\s*security|soc\s*sec|tax\s*id|itin)\b/i, label: "a Social Security number" },
  { re: /\b(card\s*(number|no|#)|credit\s*card|debit\s*card|cvv|cvc|security\s*code|expiration\s*date|expiry)\b/i, label: "payment card details" },
  { re: /\b(bank\s*account|routing\s*(number|no)|account\s*and\s*routing)\b/i, label: "bank account details" },
  { re: /\b(password|passcode|pin\b|pin\s*number|login|username)\b/i, label: "a password or PIN" },
];

/**
 * Whether a question asks for something never collected by text.
 *
 * @param question - The office's question as Billy phrased it.
 * @returns The blocked topic's label, or `null` when the question may be texted.
 */
export function blockedTopic(question: string): string | null {
  return BLOCKED_TOPICS.find((t) => t.re.test(question))?.label ?? null;
}

/**
 * Whether a reply looks like an SSN or a card/bank number (so it is withheld even if the question
 * looked harmless). Dates, short IDs, phone numbers, and ZIP codes pass.
 *
 * @param answer - The patient's reply.
 * @returns True when it must not be passed to Billy.
 */
export function looksSensitive(answer: string): boolean {
  if (/\b\d{3}[-\s]\d{2}[-\s]\d{4}\b/.test(answer)) return true; // SSN with separators
  const digitRuns = answer.match(/\d[\d\s-]{7,}\d/g) ?? [];
  return digitRuns.some((run) => {
    const digits = run.replace(/\D/g, "");
    return digits.length === 9 || digits.length >= 12; // bare SSN, or card/bank numbers
  });
}

/**
 * Normalizes a question for texting: one line, no surrounding quotes, length-capped.
 *
 * @param question - Billy's question.
 * @returns Cleaned question.
 */
export function cleanQuestion(question: string): string {
  const one = question.replace(/\s+/g, " ").trim().replace(/^["“'”]+|["“'”]+$/g, "");
  return one.length > MAX_QUESTION_CHARS ? `${one.slice(0, MAX_QUESTION_CHARS - 1)}…` : one;
}

/** An open question on a case. */
export interface OpenQuestion {
  questionId: string;
  question: string;
  counterparty: string;
  /** ISO timestamp the question was asked. */
  at: string;
}

/** Outcome of a question, as returned to Billy's tool. */
export type QuestionOutcome =
  | { status: "answered"; answer: string }
  | { status: "skipped" }
  | { status: "withheld" }
  | { status: "timeout" };

/**
 * The latest unanswered question that may still capture the patient's next text.
 *
 * @param c - Stored case.
 * @param now - Current time.
 * @returns The open question, or `null`.
 */
export function openQuestionOf(c: StoredCase, now: Date = new Date()): OpenQuestion | null {
  const asked = c.events.filter((e) => e.type === "patient_question_asked").at(-1);
  if (!asked) return null;
  const data = asked.data as Omit<OpenQuestion, "at">;
  const answered = c.events.some((e) => e.type === "patient_question_answered" && (e.data as { questionId?: string }).questionId === data.questionId);
  if (answered || now.getTime() - Date.parse(asked.createdAt) > QUESTION_OPEN_MS) return null;
  return { ...data, at: asked.createdAt };
}

/**
 * Opens a question and queues the text to the patient's linked phone.
 *
 * @param caseId - Case ID.
 * @param question - The office's question (already checked with `blockedTopic`).
 * @param counterparty - Who is asking, e.g. "Quillhaven Medical Group's billing office".
 * @returns The question ID.
 */
export async function askPatient(caseId: string, question: string, counterparty: string): Promise<string> {
  const store = getStore();
  const questionId = newId("qst");
  const q = cleanQuestion(question);
  await store.addEvent(caseId, "patient_question_asked", { questionId, question: q, counterparty });
  await store.addEvent(caseId, "imessage_direct", {
    messageId: newId("msg"),
    text: ["BillLess · Billy is on a call", `With: ${counterparty}`, "They're asking:", `“${q}”`, "", "Reply with:", "• Your answer → Billy reads it to them exactly as you write it", "• SKIP → Don't share it", "", "Never text your Social Security number, card numbers, or passwords."].join("\n"),
  });
  return questionId;
}

/**
 * Records the patient's reply to an open question. SKIP declines; replies that look like an SSN or
 * card/bank number are withheld; replies after Billy stopped waiting are recorded as late and not
 * shared.
 *
 * @param caseId - Case ID.
 * @param q - The open question.
 * @param text - What the patient texted.
 * @returns The reply to text back to the patient.
 */
export async function answerQuestion(caseId: string, q: OpenQuestion, text: string): Promise<string> {
  const store = getStore();
  const reply = text.trim();
  if (/^(skip|no|don'?t share|do not share)\.?$/i.test(reply)) {
    await store.addEvent(caseId, "patient_question_answered", { questionId: q.questionId, outcome: "skipped" });
    return `Okay. Billy won't share that with ${q.counterparty}.`;
  }
  if (looksSensitive(reply)) {
    await store.addEvent(caseId, "patient_question_answered", { questionId: q.questionId, outcome: "withheld" });
    return "That looks like a Social Security, card, or bank number, so Billy won't share it. Please don't text those. Billy will tell them you'll provide it directly.";
  }
  if (Date.now() - Date.parse(q.at) > QUESTION_WAIT_MS) {
    await store.addEvent(caseId, "patient_question_answered", { questionId: q.questionId, outcome: "late" });
    return `Thanks, but Billy had to move on and told ${q.counterparty} you'll provide that directly. Nothing was shared.`;
  }
  const answer = reply.length > MAX_ANSWER_CHARS ? reply.slice(0, MAX_ANSWER_CHARS) : reply;
  await store.addEvent(caseId, "patient_question_answered", { questionId: q.questionId, outcome: "answered", answer });
  return `Thanks. Billy will tell ${q.counterparty}: “${answer}”`;
}

/**
 * Waits for the patient's reply to a question.
 *
 * Side effects: polls the store.
 *
 * @param caseId - Case ID.
 * @param questionId - The question.
 * @param timeoutMs - How long to wait.
 * @returns The outcome; `timeout` when no reply arrived in time.
 */
export async function waitForAnswer(caseId: string, questionId: string, timeoutMs = QUESTION_WAIT_MS): Promise<QuestionOutcome> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const c = await getStore().getCase(caseId);
    const ev = c?.events.find((e) => e.type === "patient_question_answered" && (e.data as { questionId?: string }).questionId === questionId);
    if (ev) {
      const d = ev.data as { outcome: "answered" | "skipped" | "withheld" | "late"; answer?: string };
      if (d.outcome === "answered") return { status: "answered", answer: d.answer ?? "" };
      return d.outcome === "late" ? { status: "timeout" } : { status: d.outcome };
    }
    if (Date.now() >= deadline) return { status: "timeout" };
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}
