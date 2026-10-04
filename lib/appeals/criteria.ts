/**
 * @file Denial criteria checked against the patient's records (SPEC.md §4.10, MVP 5). Pure; no LLM.
 *
 * The insurer's policy is identified by the policy ID the patient confirmed on the letter and looked
 * up here; each criterion is a fixed rule over FinchNode records. A criterion is **met** only when a
 * record satisfies every part of the rule, **unconfirmed** when a record matches but a required part
 * (e.g. medication status) isn't recorded, and **missing** otherwise. Evidence is the records
 * themselves (`VerbatimFact`), never a summary.
 */
import type { ConfirmedDenial, IsoDate, RecordCategory, VerbatimFact } from "@/lib/types";

/** One fixed rule for a criterion. */
export interface CriterionRule {
  id: string;
  /** The insurer's criterion, as printed on its policy (template text). */
  text: string;
  category: RecordCategory;
  /** Clinical codes that match (SNOMED CT, RxNorm, LOINC). */
  codes: string[];
  /** Lower-case words; a record whose text contains all words of one entry also matches. */
  textMatches: string[][];
  /** Record must be dated on/before the letter date and at most this many days before it. */
  maxDaysBefore?: number;
  /** Record status must be one of these (e.g. "active"); a missing status makes it unconfirmed. */
  requireStatus?: string[];
  /** Plain description of what would satisfy it, used when it's missing. */
  needed: string;
}

/** A policy we can check: its ID as printed, title, and rules. DEMO POLICIES ONLY. */
export interface PolicyRules {
  id: string;
  title: string;
  rules: CriterionRule[];
}

/**
 * Demo policy lookup. Codes: SNOMED CT 40930008 hypothyroidism; RxNorm 966221 levothyroxine
 * 0.05 MG oral tablet; LOINC 3016-3 TSH and 3024-7 free T4.
 */
export const POLICY_LOOKUP: Readonly<Record<string, PolicyRules>> = Object.freeze({
  "WMH-MP-112": {
    id: "WMH-MP-112",
    title: "Specialist care for thyroid disorders",
    rules: [
      { id: "diagnosis", text: "A documented diagnosis of a thyroid disorder", category: "condition", codes: ["40930008"], textMatches: [["hypothyroid"], ["thyroid"]], needed: "a recorded thyroid disorder diagnosis from your doctor" },
      { id: "treatment", text: "Current thyroid hormone treatment", category: "medication", codes: ["966221"], textMatches: [["levothyroxine"]], requireStatus: ["active"], needed: "a record of current thyroid hormone treatment (for example, a levothyroxine prescription)" },
      { id: "recent_test", text: "A thyroid function test within 60 days before the request", category: "lab", codes: ["3016-3", "3024-7"], textMatches: [["thyrotropin"], ["thyroxine"]], maxDaysBefore: 60, needed: "a thyroid function test (TSH or free T4) from the 60 days before the request" },
    ],
  },
});

/** Result for one criterion. */
export interface CriterionResult {
  id: string;
  text: string;
  status: "met" | "unconfirmed" | "missing";
  /** Records that satisfy (met) or partly match (unconfirmed) the rule, newest first. */
  evidence: VerbatimFact[];
  /** What was searched, for the citation. */
  searched: string;
  /** What would satisfy it, when not met. */
  needed: string | null;
}

/** Result for a whole denial. */
export interface DenialEvaluation {
  policyKnown: boolean;
  policy: PolicyRules | null;
  criteria: CriterionResult[];
  allMet: boolean;
  /** Providers whose records were searched. */
  providers: string[];
}

/**
 * Days from `a` back to `b` (positive when `a` is before `b`).
 *
 * @param a - Earlier ISO date.
 * @param b - Later ISO date.
 * @returns Whole days.
 */
function daysBefore(a: IsoDate, b: IsoDate): number {
  return (Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000;
}

/**
 * Whether a record is the kind a rule asks for (category plus code or text).
 *
 * @param r - Record.
 * @param rule - Rule.
 * @returns True if it matches.
 */
function isKind(r: VerbatimFact, rule: CriterionRule): boolean {
  if (r.category !== rule.category) return false;
  if (r.code && rule.codes.includes(r.code)) return true;
  const text = r.text.toLowerCase();
  return rule.textMatches.some((words) => words.every((w) => text.includes(w)));
}

/**
 * Checks one criterion against the records.
 *
 * @param rule - Criterion rule.
 * @param records - Patient records from every provider.
 * @param letterDate - Denial letter date (windows count back from it), or null.
 * @returns The criterion result.
 */
export function checkCriterion(rule: CriterionRule, records: VerbatimFact[], letterDate: IsoDate | null): CriterionResult {
  const window = rule.maxDaysBefore !== undefined ? ` dated 0–${rule.maxDaysBefore} days before ${letterDate ?? "the letter date"}` : ` dated on or before ${letterDate ?? "the letter date"}`;
  const searched = `${rule.category} records matching ${[...rule.codes].join("/")}${window}`;
  const inTime = (r: VerbatimFact) => {
    if (!letterDate) return false;
    const d = daysBefore(r.recordedAt, letterDate);
    return d >= 0 && (rule.maxDaysBefore === undefined || d <= rule.maxDaysBefore);
  };
  const candidates = records.filter((r) => isKind(r, rule) && inTime(r)).sort((a, b) => b.recordedAt.localeCompare(a.recordedAt));
  const full = candidates.filter((r) => !rule.requireStatus || (r.status ? rule.requireStatus.includes(r.status) : false));
  if (full.length) return { id: rule.id, text: rule.text, status: "met", evidence: full, searched, needed: null };
  const partial = rule.requireStatus ? candidates.filter((r) => !r.status) : [];
  if (partial.length) return { id: rule.id, text: rule.text, status: "unconfirmed", evidence: partial, searched, needed: `confirmation that this is current (${rule.needed})` };
  return { id: rule.id, text: rule.text, status: "missing", evidence: [], searched, needed: rule.needed };
}

/**
 * Evaluates a confirmed denial against the patient's records.
 *
 * @param denial - Confirmed denial letter.
 * @param records - Records from every connected provider.
 * @returns Per-criterion results; `policyKnown: false` (and no criteria) when the policy isn't in the lookup.
 */
export function evaluateDenial(denial: ConfirmedDenial, records: VerbatimFact[]): DenialEvaluation {
  const providers = [...new Set(records.map((r) => r.provider))];
  const policy = denial.policyId ? POLICY_LOOKUP[denial.policyId.trim().toUpperCase()] ?? null : null;
  if (!policy) return { policyKnown: false, policy: null, criteria: [], allMet: false, providers };
  const criteria = policy.rules.map((rule) => checkCriterion(rule, records, denial.letterDate));
  return { policyKnown: true, policy, criteria, allMet: criteria.every((c) => c.status === "met"), providers };
}
