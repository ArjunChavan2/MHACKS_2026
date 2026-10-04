/**
 * @file Revised-statement verification (SPEC.md §4.6, §6 MVP 2). Pure; never uses an LLM.
 *
 * A correction counts only when a patient-confirmed revised statement shows it. Lines are matched
 * by billing code and service date (revised statements renumber lines), earliest original line
 * first, so with two identical lines and one removed, the later copy is the one reported removed,
 * matching how the duplicate rule questions the later copies.
 */
import type { ConfirmedBill, ConfirmedBillLine, Finding, RevisedComparison } from "@/lib/types";

/**
 * Matching key for a line across statements.
 *
 * @param l - Confirmed line.
 * @returns "code|date".
 */
function key(l: ConfirmedBillLine): string {
  return `${l.code ?? ""}|${l.serviceDate ?? ""}`;
}

/**
 * Compares a revised statement with the original bill and decides which findings it resolves.
 *
 * A finding is resolved when every bill line it questions was removed or reduced to $0. A finding
 * the office confirmed (`status: "confirmed"`) whose lines are still billed is "not reflected".
 * Confirmed savings are the drop in amount due, never negative, and 0 when either total is missing.
 *
 * @param original - The confirmed original bill.
 * @param revised - The confirmed revised statement.
 * @param findings - The case's findings.
 * @returns The comparison.
 * @example compareRevised(bill, revised, findings).confirmedSavingsCents // 6800 when line 5 ($68) is removed
 */
export function compareRevised(original: ConfirmedBill, revised: ConfirmedBill, findings: Finding[]): RevisedComparison {
  const pool = new Map<string, ConfirmedBillLine[]>();
  for (const l of revised.lines) pool.set(key(l), [...(pool.get(key(l)) ?? []), l]);

  const removedLines: number[] = [];
  const reducedLines: Array<[number, number, number]> = [];
  const zeroed = new Set<number>();
  for (const l of [...original.lines].sort((a, b) => a.lineNumber - b.lineNumber)) {
    const candidates = pool.get(key(l)) ?? [];
    if (!candidates.length) {
      removedLines.push(l.lineNumber);
      continue;
    }
    // Prefer an identical charge; otherwise take the first remaining line with this code and date.
    const i = Math.max(0, candidates.findIndex((c) => c.chargeCents === l.chargeCents));
    const [match] = candidates.splice(i, 1);
    if (match.chargeCents < l.chargeCents) {
      reducedLines.push([l.lineNumber, l.chargeCents, match.chargeCents]);
      if (match.chargeCents === 0) zeroed.add(l.lineNumber);
    }
  }
  const newLines = [...pool.values()].flat().map((l) => l.lineNumber).sort((a, b) => a - b);

  const gone = new Set([...removedLines, ...zeroed]);
  const resolvedFindingIds: string[] = [];
  const notReflectedFindingIds: string[] = [];
  for (const f of findings) {
    if (f.status === "withdrawn" || !f.lineNumbers.length) continue;
    if (f.lineNumbers.every((n) => gone.has(n))) resolvedFindingIds.push(f.id);
    else if (f.status === "confirmed") notReflectedFindingIds.push(f.id);
  }

  const before = original.amountDueCents;
  const after = revised.amountDueCents;
  const confirmedSavingsCents = before !== null && after !== null ? Math.max(0, before - after) : 0;
  return {
    removedLines,
    reducedLines,
    newLines,
    originalDueCents: before,
    revisedDueCents: after,
    confirmedSavingsCents,
    resolvedFindingIds,
    notReflectedFindingIds,
  };
}
