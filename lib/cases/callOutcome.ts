/**
 * @file Turns a saved call's extracted outcome into a proposed billing-office response (MVP 4).
 * Pure. The proposal comes from an AI reading the call, so the patient confirms it before anything
 * changes on the case (SPEC.md §2: the model proposes, the patient confirms).
 */
import type { CallRecord } from "@/lib/calls/history";
import type { CounterpartyResponse, Finding, ResponseKind } from "@/lib/types";

/** Extracted field per finding rule (billing agent's data collection). */
const FIELD_FOR_RULE: Partial<Record<Finding["rule"], string>> = {
  duplicate_charge: "duplicate_tsh",
  bill_exceeds_eob: "eob_difference",
  documentation_gap: "free_t4_documentation",
};

/** Extracted value → response kind; `not_discussed` (or anything else) maps to nothing. */
const KIND_FOR_VALUE: Record<string, ResponseKind> = {
  confirmed: "confirms_error",
  refused: "refused",
  needs_documents: "needs_more_info",
  will_send_later: "will_send_later",
};

/** A proposed outcome for one call. */
export type CallOutcome =
  | { kind: "response"; response: CounterpartyResponse; summary: string[] }
  | { kind: "no_result"; reason: "call_failed" | "consent_not_given" | "nothing_resolved"; summary: string[] };

/** Plain words for each value, for the confirm screen. */
const WORDS: Record<string, string> = {
  confirmed: "agreed it's an error and will fix it",
  refused: "said it's valid and won't change it",
  needs_documents: "needs documents before deciding",
  will_send_later: "will send something later",
};

/**
 * Proposes what to record from a call.
 *
 * @param call - Saved call with `extracted` values.
 * @param findings - The case's open findings.
 * @param office - Who answered (e.g. the billing entity).
 * @returns A proposed response (per finding) or a "no result" outcome; `null` when the call has no extracted outcome.
 */
export function proposeOutcome(call: CallRecord, findings: Finding[], office: string): CallOutcome | null {
  const x = call.extracted ?? {};
  if (!Object.keys(x).length) return null;
  const result = x.call_result ?? "reached_office";
  if (result === "call_failed") return { kind: "no_result", reason: "call_failed", summary: ["The call didn't reach anyone who could help (no answer, voicemail, or dropped)."] };
  if (result === "consent_not_given") return { kind: "no_result", reason: "consent_not_given", summary: ["The office needed the patient's verification, and consent wasn't given in time."] };
  const perFinding: CounterpartyResponse["perFinding"] = [];
  const summary: string[] = [];
  for (const f of findings) {
    if (f.patientExcluded || f.status === "withdrawn" || (f.status === "confirmed" && f.verified)) continue;
    const field = FIELD_FOR_RULE[f.rule];
    const value = field ? x[field] : undefined;
    const kind = value ? KIND_FOR_VALUE[value] : undefined;
    if (!kind) continue;
    perFinding.push({
      findingId: f.id,
      kind,
      ...(kind === "will_send_later" ? { neededDocument: f.rule === "duplicate_charge" || f.rule === "bill_exceeds_eob" ? "revised statement" : "documentation", ...(x.promised_by && /^\d{4}-\d{2}-\d{2}$/.test(x.promised_by) ? { promisedBy: x.promised_by } : {}) } : {}),
      ...(kind === "needs_more_info" ? { neededDocument: "what the office asked for" } : {}),
    });
    summary.push(`${f.title}: the office ${WORDS[value as string]}.`);
  }
  if (!perFinding.length) return { kind: "no_result", reason: "nothing_resolved", summary: ["The office didn't give an answer on any of the issues."] };
  const note = [x.reference_number && `Reference ${x.reference_number}`, x.representative_name && `representative ${x.representative_name}`].filter(Boolean).join(", ");
  return { kind: "response", response: { from: `${office} billing office (phone call)`, perFinding, ...(note ? { note: `${note} (from the call with Billy)` } : {}) }, summary };
}
