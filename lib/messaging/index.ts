/**
 * @file iMessage messaging core (SPEC.md §4.8, §6 MVP 3): parses the patient's replies and composes
 * every outgoing text from the case state. Pure and deterministic; never calls a model.
 *
 * Core rule (SPEC.md §2 rule 1): no text here is written by an LLM. Updates are built from the
 * "What happens next?" card (`view.state.next`), which `lib/cases/machine.ts` writes from templates.
 * "Why?" answers quote only the finding's own template strings (`title`, `statusNote`,
 * `explanation`) and its sources through `describeSource`, so every health fact in a text is a
 * verbatim record citation with provider and date.
 */
import { describeSource } from "@/app/_components/sources";
import type { ActionId, CasePhase } from "@/lib/cases/machine";
import type { CaseView } from "@/lib/cases/service";
import { longDate, usd } from "@/lib/format";
import type { Finding } from "@/lib/types";

/**
 * Longest text we send in one iMessage before pointing to the case link for the rest. The plan said
 * ~600, but a documentation-gap explanation alone is ~480 characters, which left no room for the
 * record citation that is the point of a "why" answer; iMessage itself has no practical limit.
 */
export const MAX_TEXT_CHARS = 1000;

/** Order of sources in a "why" answer: medical-record evidence first, so it survives trimming. */
const SOURCE_ORDER: Record<string, number> = { record: 0, records_searched: 1, response: 2, document: 3, bill_line: 4, eob_line: 5, eob_total: 6, bill_total: 7 };

/** How long an approval prompt stays answerable by "A". */
export const PROMPT_TTL_MS = 24 * 60 * 60 * 1000;

/** Letters and digits used in link codes: no lookalikes (no 0/O, 1/I). */
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/** Length of a link code. */
const CODE_LENGTH = 6;

/** What a reply from the patient asks for. */
export type Intent =
  | { kind: "link"; code: string }
  | { kind: "approve" }
  | { kind: "decline" }
  | { kind: "why"; index?: number; question?: string }
  | { kind: "status" }
  | { kind: "stop" }
  | { kind: "help" };

/**
 * The parts of a case that decide whether the patient should get a text. Stored with each
 * `imessage_notified` event so a restart doesn't resend the same update.
 */
export interface NotifySnapshot {
  /** The card's action. */
  actionId: ActionId;
  /** The card's target (task or document ID), or `null`. */
  target: string | null;
  /** Number of counterparty responses recorded so far. */
  responses: number;
  /** Confirmed savings in cents, or `null` before a revised statement is verified. */
  confirmedCents: number | null;
  /** Whether the card is an overdue follow-up. */
  overdue: boolean;
  /** Case phase. */
  phase: CasePhase;
}

/** An approval prompt sent over iMessage ("Reply A to approve…"), as stored on the case. */
export interface ImessagePrompt {
  promptId: string;
  /** The exact action an "A" approves. */
  actionId: ActionId;
  /** The exact target an "A" approves, if any. */
  target?: string;
  /** ISO timestamp after which "A" no longer approves this prompt. */
  expiresAt: string;
  /** True once an "A" ran the action. */
  done: boolean;
}

/** A composed text plus the approval it asks for, if any. */
export interface Composed {
  text: string;
  /** Set when the text ends with "Reply A to approve"; the service stores it as a prompt. */
  prompt?: { actionId: ActionId; target?: string };
}

/** Why `resolvePrompt` refused an "A". */
export type PromptRefusal = "none" | "expired" | "stale" | "done";

/**
 * Parses a reply into an intent. Case-insensitive; surrounding spaces and trailing punctuation are
 * ignored. Anything unrecognized is `help`.
 *
 * @param text - The message the patient sent.
 * @returns The intent.
 */
export function parseReply(text: string): Intent {
  const t = text.trim().replace(/[.!?]+$/, "").trim();
  const lower = t.toLowerCase();
  const link = /^link\s+([a-z0-9]{4,10})$/i.exec(t);
  if (link) return { kind: "link", code: link[1].toUpperCase() };
  if (/^(a|yes|y|approve|approved|ok|okay)$/.test(lower)) return { kind: "approve" };
  if (/^(b|no|n|hold|wait)$/.test(lower)) return { kind: "decline" };
  if (/^(status|update|where are we)$/.test(lower)) return { kind: "status" };
  if (/^(stop|unlink|unsubscribe)$/.test(lower)) return { kind: "stop" };
  const why = /^why(?:\s+#?(\d{1,2}))?$/.exec(lower);
  if (why) return why[1] ? { kind: "why", index: Number(why[1]) } : { kind: "why" };
  if (/\bwhy\b/.test(lower)) return { kind: "why", question: t };
  return { kind: "help" };
}

/**
 * Makes a new link code (6 characters, no lookalikes).
 *
 * @returns e.g. "4F7K2Q".
 */
export function newLinkCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(CODE_LENGTH));
  return Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");
}

/**
 * The case link included in texts.
 *
 * @param baseUrl - Deployment origin, e.g. "https://billless.tech".
 * @param caseId - Case ID.
 * @returns URL that opens the case screen.
 */
export function caseLink(baseUrl: string, caseId: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/?case=${encodeURIComponent(caseId)}`;
}

/**
 * Plain status words for a finding (same meaning as the case screen's chips).
 *
 * @param f - Finding.
 * @returns e.g. "potential issue", "office confirmed, awaiting proof".
 */
export function statusWords(f: Finding): string {
  if (f.status === "withdrawn") return "withdrawn";
  if (f.status === "pending") return "pending";
  if (f.status === "confirmed") return f.verified ? "confirmed and verified" : "office confirmed, awaiting proof";
  return "potential issue";
}

/**
 * Whether the card's action is one the patient can approve by reply right now.
 *
 * @param view - Case view.
 * @returns True if the card needs approval and that exact action and target are allowed.
 */
function approvable(view: CaseView): boolean {
  const next = view.state.next;
  return next.needsApproval && view.state.allowed.some((a) => a.id === next.actionId && (a.target ?? undefined) === (next.target ?? undefined));
}

/**
 * One line with the savings trio, or `null` before the audit.
 *
 * @param view - Case view.
 * @returns e.g. "In question: $122.00 · Offered: — · Confirmed: —".
 */
function savingsLine(view: CaseView): string | null {
  const s = view.state.savings;
  if (!s) return null;
  return `In question: ${usd(s.questionedCents)} · Offered: ${s.offeredCents ? usd(s.offeredCents) : "—"} · Confirmed: ${s.confirmedCents != null ? usd(s.confirmedCents) : "—"}`;
}

/**
 * Fits text into one iMessage: whole lines are kept until the budget runs out, then the case link
 * is added for the rest. Lines are never cut mid-sentence, so a citation is shown whole or not at all.
 *
 * @param lines - Lines in order; the first is always kept.
 * @param link - Case link appended at the end.
 * @returns The text.
 */
export function fit(lines: string[], link: string): string {
  const tail = `Open your case: ${link}`;
  const kept: string[] = [];
  let dropped = 0;
  for (const line of lines) {
    const next = [...kept, line, tail].join("\n");
    if (kept.length && next.length > MAX_TEXT_CHARS) dropped++;
    else kept.push(line);
  }
  if (dropped) kept.push(`(${dropped} more in the app)`);
  return [...kept, tail].join("\n");
}

/**
 * Composes an update from the "What happens next?" card. Ends with "Reply A to approve…" only when
 * the card's exact action is allowed and needs approval.
 *
 * @param view - Case view.
 * @param link - Case link.
 * @returns The text and the prompt it asks for, if any.
 */
export function composeUpdate(view: CaseView, link: string): Composed {
  const next = view.state.next;
  const lines = [`BillLess: ${next.title}`, next.why];
  if (next.needed) lines.push(`Needed: ${next.needed}`);
  if (next.deadline) lines.push(next.deadline === "unconfirmed" ? "No date given yet" : `${next.overdue ? "Was due" : "Expected by"} ${longDate(next.deadline)}${next.overdue ? " (overdue)" : ""}`);
  const savings = savingsLine(view);
  if (savings) lines.push(savings);
  if (!approvable(view)) return { text: fit(lines, link) };
  lines.push("Reply A to approve, B to hold, or WHY to see why.");
  return { text: fit(lines, link), prompt: { actionId: next.actionId, ...(next.target ? { target: next.target } : {}) } };
}

/**
 * Composes the STATUS reply: the current update plus a numbered list of the case's issues (the
 * numbers `WHY <n>` refers to).
 *
 * @param view - Case view.
 * @param link - Case link.
 * @returns The text and the prompt it asks for, if any.
 */
export function composeStatus(view: CaseView, link: string): Composed {
  const update = composeUpdate(view, link);
  const findings = view.audit?.findings ?? [];
  if (!findings.length) return update;
  const list = findings.map((f, i) => `${i + 1}. ${f.title} (${statusWords(f)})`);
  const lines = [...update.text.split("\n").slice(0, -1), "Issues:", ...list, "Reply WHY <number> for the evidence."];
  return { text: fit(lines, link), ...(update.prompt ? { prompt: update.prompt } : {}) };
}

/**
 * Composes the grounded answer to "why was this flagged?": the finding's template title, status note,
 * and explanation, then each source exactly as `describeSource` writes it (verbatim record text with
 * provider and date), records first. Nothing else is added.
 *
 * @param view - Case view.
 * @param findingId - Finding to explain.
 * @param link - Case link.
 * @returns The text, or a "not found" note with the link.
 */
export function composeWhy(view: CaseView, findingId: string, link: string): string {
  const f = view.audit?.findings.find((x) => x.id === findingId);
  if (!f) return fit(["I couldn't find that issue on your case."], link);
  const lines = [`Why "${f.title}" (${statusWords(f)}):`];
  if (f.statusNote) lines.push(f.statusNote);
  lines.push(f.explanation, "Evidence:");
  const sources = [...(f.statusSources ?? []), ...f.sources].sort((a, b) => (SOURCE_ORDER[a.kind] ?? 9) - (SOURCE_ORDER[b.kind] ?? 9));
  for (const s of sources) lines.push(`- ${describeSource(s)}`);
  return fit(lines, link);
}

/** Words ignored when matching a free-text question to a finding. */
const STOP_WORDS = new Set(["why", "was", "the", "this", "that", "flagged", "charge", "charged", "line", "bill", "and", "for", "what", "about", "is", "it", "my", "a", "an", "of", "on", "did", "you", "are"]);

/**
 * Picks the finding a free-text "why" question is about by word overlap with finding titles
 * (deterministic; no model). Returns `null` when nothing overlaps.
 *
 * @param question - The patient's question, e.g. "why was the free T4 flagged?".
 * @param findings - The case's findings.
 * @returns The best-matching finding ID, or `null`.
 */
export function matchFinding(question: string, findings: Finding[]): string | null {
  const words = (s: string) => new Set(s.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 1 && !STOP_WORDS.has(w)));
  const q = words(question);
  let best: { id: string; score: number } | null = null;
  for (const f of findings) {
    const score = [...words(f.title)].filter((w) => q.has(w)).length;
    if (score > 0 && (!best || score > best.score)) best = { id: f.id, score };
  }
  return best?.id ?? null;
}

/**
 * Takes the snapshot that decides whether to text.
 *
 * @param view - Case view.
 * @returns The snapshot.
 */
export function notifySnapshotOf(view: CaseView): NotifySnapshot {
  const next = view.state.next;
  return {
    actionId: next.actionId,
    target: next.target ?? null,
    responses: view.state.timeline.filter((e) => e.type === "response_recorded").length,
    confirmedCents: view.state.savings?.confirmedCents ?? null,
    overdue: next.overdue,
    phase: view.state.phase,
  };
}

/**
 * Compares two snapshots field by field.
 *
 * @param a - Snapshot.
 * @param b - Snapshot.
 * @returns True if identical.
 */
export function sameSnapshot(a: NotifySnapshot, b: NotifySnapshot): boolean {
  return a.actionId === b.actionId && a.target === b.target && a.responses === b.responses && a.confirmedCents === b.confirmedCents && a.overdue === b.overdue && a.phase === b.phase;
}

/**
 * Decides whether a change deserves a text: the card changed (action or target), a new response was
 * recorded, confirmed savings changed, a follow-up became overdue, or the case resolved. Not on every
 * event.
 *
 * @param prev - Snapshot from the last text, or `null` if none was sent.
 * @param view - Current case view.
 * @returns True if the patient should get an update.
 */
export function decideNotify(prev: NotifySnapshot | null, view: CaseView): boolean {
  const now = notifySnapshotOf(view);
  if (!prev) return true;
  return (
    prev.actionId !== now.actionId ||
    prev.target !== now.target ||
    now.responses > prev.responses ||
    prev.confirmedCents !== now.confirmedCents ||
    (now.overdue && !prev.overdue) ||
    (now.phase === "resolved" && prev.phase !== "resolved")
  );
}

/**
 * Finds the prompt an "A" answers. Only the latest prompt counts, and only while it is unexpired,
 * not already done, and still the card's exact allowed action and target.
 *
 * @param prompts - Prompts on the case, oldest first.
 * @param view - Current case view.
 * @param now - Current time.
 * @returns The prompt, or why it can't be approved.
 */
export function resolvePrompt(prompts: ImessagePrompt[], view: CaseView, now: Date): { ok: true; prompt: ImessagePrompt } | { ok: false; reason: PromptRefusal } {
  const p = prompts.at(-1);
  if (!p) return { ok: false, reason: "none" };
  if (p.done) return { ok: false, reason: "done" };
  if (Date.parse(p.expiresAt) <= now.getTime()) return { ok: false, reason: "expired" };
  const next = view.state.next;
  if (next.actionId !== p.actionId || (next.target ?? undefined) !== (p.target ?? undefined) || !approvable(view)) return { ok: false, reason: "stale" };
  return { ok: true, prompt: p };
}

/**
 * The HELP reply.
 *
 * @param link - Case link, or `null` when the handle isn't linked to a case.
 * @returns The text.
 */
export function composeHelp(link: string | null): string {
  const lines = ["BillLess commands:", "STATUS: where your case stands", "A / B: approve or hold the step I asked about", "WHY or WHY <number>: the evidence behind an issue", "STOP: stop texts about this case"];
  return link ? fit(lines, link) : [...lines, "To start, open your case on the web and text the LINK code it shows."].join("\n");
}
