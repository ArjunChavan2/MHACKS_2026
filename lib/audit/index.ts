/**
 * @file Runs the bill audit and computes the verdict block (SPEC.md §4.3, §4.4, §4.6).
 *
 * Accepts only confirmed documents (SPEC.md §5.6). Deterministic: the same inputs always produce
 * the same findings in the same order. Pure: no side effects.
 */
import type { AuditResult, ConfirmedBill, ConfirmedEob, Finding, Verdict, VerbatimFact } from "@/lib/types";
import { findBillExceedsEob, findDocumentationGaps, findDuplicateCharges, findInsurerDenials } from "./rules";

/**
 * Computes the verdict. Each bill line's questioned amount is counted once even when several
 * findings question it; findings without lines add their amount directly.
 *
 * @param bill - Confirmed bill.
 * @param findings - Findings from the rules.
 * @returns The verdict; `offeredCents` and `confirmedCents` stay `null` in MVP 1.
 */
export function computeVerdict(bill: ConfirmedBill, findings: Finding[]): Verdict {
  const perLine = new Map<number, number>();
  let unlinked = 0;
  for (const f of findings) {
    if (f.patientExcluded || f.status === "withdrawn") continue;
    if (!f.lineNumbers.length) {
      unlinked += f.amountQuestionedCents;
      continue;
    }
    for (const n of f.lineNumbers) {
      const line = bill.lines.find((l) => l.lineNumber === n);
      const amount = line ? (line.patientResponsibilityCents ?? line.chargeCents) : 0;
      perLine.set(n, Math.max(perLine.get(n) ?? 0, amount));
    }
  }
  const questioned = [...perLine.values()].reduce((a, b) => a + b, 0) + unlinked;
  return { totalBilledCents: bill.totalChargesCents, questionedCents: questioned, offeredCents: null, confirmedCents: null };
}

/**
 * Runs every MVP 1 rule.
 *
 * @param bill - Confirmed bill.
 * @param eob - Confirmed EOB for the same visit, or `null`.
 * @param records - Patient records from every connected provider.
 * @param providers - Providers searched (for documentation-gap citations).
 * @returns Findings (duplicates, then bill vs EOB, then documentation gaps) and the verdict.
 */
export function runAudit(
  bill: ConfirmedBill,
  eob: ConfirmedEob | null,
  records: VerbatimFact[],
  providers: string[],
): AuditResult {
  const findings = [
    ...findDuplicateCharges(bill),
    ...findBillExceedsEob(bill, eob),
    ...findDocumentationGaps(bill, records, providers),
    ...findInsurerDenials(bill, eob),
  ];
  return { findings, verdict: computeVerdict(bill, findings) };
}
