/**
 * @file Placeholder filling and the "no invented facts" guard (SPEC.md §4.5, §5.6).
 *
 * Drafts are written with placeholders such as `{{finding:dup-1:amount}}` or `{{provider}}`. Code
 * replaces each with a value from the confirmed bill or a rule-written finding. A draft is rejected
 * if it uses an unknown placeholder, leaves one unfilled, skips a finding, or contains its own
 * money amounts, dates, or billing codes outside placeholders. All functions are pure.
 */
import { longDate, usd } from "@/lib/format";
import type { ConfirmedBill, DraftParagraph, Finding, Source } from "@/lib/types";

/** Matches any placeholder token. */
const TOKEN_RE = /\{\{([^{}]+)\}\}/g;

/** Facts the model must never write itself (they may only enter through placeholders). */
const FORBIDDEN: Array<[RegExp, string]> = [
  [/\$\s?\d/, "a money amount"],
  [/\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/, "a date"],
  [/\b\d{4}-\d{2}-\d{2}\b/, "a date"],
  [/\b\d{4}[0-9FTU]\b/, "a billing code"],
  [/\b[A-V]\d{4}\b/, "a billing code"],
];

/** Thrown when a draft breaks the placeholder rules. The caller falls back to the template. */
export class DraftRejectedError extends Error {
  constructor(public readonly reasons: string[]) {
    super(`Draft rejected: ${reasons.join("; ")}`);
    this.name = "DraftRejectedError";
  }
}

/** Header values a draft may use (a confirmed bill, or a balance statement's patient-confirmed header). */
export type BillContext = Pick<
  ConfirmedBill,
  "billingEntity" | "patientName" | "accountNumber" | "serviceStart" | "serviceEnd" | "amountDueCents"
>;

/** Values available to a draft, built from confirmed data and findings only. */
export interface FillContext {
  /** Simple tokens, e.g. `provider` → "Northstar Health System". */
  simple: Record<string, string>;
  /** Findings by ID, for `finding:<id>:<field>` tokens. */
  findings: Map<string, Finding>;
}

/**
 * Builds the fill context from a confirmed bill and its findings.
 *
 * @param bill - Confirmed bill (or a balance statement's confirmed header values).
 * @param findings - Rule-produced findings.
 * @returns Values for every allowed placeholder.
 */
export function fillContext(bill: BillContext, findings: Finding[]): FillContext {
  const dates = bill.serviceStart
    ? bill.serviceEnd && bill.serviceEnd !== bill.serviceStart
      ? `${longDate(bill.serviceStart)} to ${longDate(bill.serviceEnd)}`
      : longDate(bill.serviceStart)
    : "the dates on the bill";
  return {
    simple: {
      provider: bill.billingEntity,
      patient_name: bill.patientName ?? "the patient",
      account_number: bill.accountNumber ?? "(account number not shown)",
      service_dates: dates,
      amount_due: bill.amountDueCents === null ? "the balance shown" : usd(bill.amountDueCents),
    },
    findings: new Map(findings.map((f) => [f.id, f])),
  };
}

/** Finding fields a letter may use. Title, explanation, and ask speak to the patient, so letters use `letter`. */
const LETTER_FINDING_FIELDS = ["letter", "amount"] as const;

/**
 * Lists the placeholder names a draft may use, for the model's instructions.
 *
 * @param ctx - Fill context.
 * @returns Allowed tokens such as "{{provider}}" and "{{finding:dup-1:letter}}".
 */
export function allowedTokens(ctx: FillContext): string[] {
  const simple = Object.keys(ctx.simple).map((k) => `{{${k}}}`);
  const per = [...ctx.findings.keys()].flatMap((id) => LETTER_FINDING_FIELDS.map((f) => `{{finding:${id}:${f}}}`));
  return [...simple, ...per];
}

/**
 * Finds `{{finding:<id>:letter}}` placeholders that don't start a sentence. The letter text is
 * complete sentences, so wrapping it inside another sentence ("regarding ... which says ...") reads
 * badly and is rejected.
 *
 * @param paragraphs - Draft paragraphs with placeholders still in place.
 * @returns One reason per misplaced placeholder; empty when every one starts a sentence.
 */
export function misplacedLetterText(paragraphs: string[]): string[] {
  const reasons: string[] = [];
  for (const p of paragraphs) {
    for (const m of p.matchAll(/\{\{\s*finding:([^:}]+):letter\s*\}\}/g)) {
      const before = p.slice(0, m.index).trimEnd();
      if (before && !/[.!?:]$/.test(before)) reasons.push(`{{finding:${m[1]}:letter}} must start a sentence`);
    }
  }
  return reasons;
}

/**
 * Resolves one placeholder.
 *
 * @param token - Inner text, e.g. "finding:dup-1:amount".
 * @param ctx - Fill context.
 * @returns The value and any finding sources it brings, or `null` if the token is unknown.
 */
function resolve(token: string, ctx: FillContext): { value: string; sources: Source[] } | null {
  const t = token.trim();
  if (t in ctx.simple) return { value: ctx.simple[t], sources: [] };
  const m = t.match(/^finding:([^:]+):(title|explanation|ask|letter|amount)$/);
  if (!m) return null;
  const f = ctx.findings.get(m[1]);
  if (!f) return null;
  const value =
    m[2] === "amount" ? usd(f.amountQuestionedCents) : m[2] === "letter" ? f.letterText : f[m[2] as "title" | "explanation" | "ask"];
  return { value, sources: f.sources };
}

/**
 * Checks that the model's own words contain no facts outside placeholders.
 *
 * @param text - Draft text with placeholders still in place.
 * @returns Reasons the text breaks the rule; empty when clean.
 */
export function forbiddenFacts(text: string): string[] {
  const stripped = text.replace(TOKEN_RE, " ");
  return FORBIDDEN.filter(([re]) => re.test(stripped)).map(([, what]) => `the draft wrote ${what} itself instead of using a placeholder`);
}

/**
 * Fills every placeholder in a draft and attaches sources per paragraph.
 *
 * @param subject - Subject line with placeholders.
 * @param paragraphs - Body paragraphs with placeholders.
 * @param ctx - Fill context.
 * @returns The filled subject and paragraphs with sources.
 * @throws {DraftRejectedError} On unknown placeholders, forbidden facts, misplaced letter text, or
 *   findings never mentioned.
 */
export function fillDraft(subject: string, paragraphs: string[], ctx: FillContext): { subject: string; paragraphs: DraftParagraph[] } {
  const reasons: string[] = [];
  const mentioned = new Set<string>();
  const fill = (text: string): DraftParagraph => {
    reasons.push(...forbiddenFacts(text));
    const sources: Source[] = [];
    const out = text.replace(TOKEN_RE, (whole, inner: string) => {
      const r = resolve(inner, ctx);
      if (!r) {
        reasons.push(`unknown placeholder ${whole}`);
        return whole;
      }
      const fm = inner.trim().match(/^finding:([^:]+):/);
      if (fm) mentioned.add(fm[1]);
      sources.push(...r.sources);
      return r.value;
    });
    if (/\{\{|\}\}/.test(out)) reasons.push("a placeholder was left unfilled");
    const unique = [...new Map(sources.map((s) => [JSON.stringify(s), s])).values()];
    return { text: out, sources: unique };
  };
  reasons.push(...misplacedLetterText(paragraphs));
  const s = fill(subject);
  const ps = paragraphs.map(fill);
  for (const id of ctx.findings.keys()) if (!mentioned.has(id)) reasons.push(`finding ${id} is never mentioned`);
  if (reasons.length) throw new DraftRejectedError([...new Set(reasons)]);
  return { subject: s.text, paragraphs: ps };
}
