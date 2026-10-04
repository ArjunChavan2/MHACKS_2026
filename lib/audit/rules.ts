/**
 * @file Deterministic bill-audit rules (SPEC.md §4.3). Never uses an LLM.
 *
 * Every finding is `potential` (a potential issue is never called an error), cites at least one
 * source, and uses template wording written here. A charge with no matching record is a
 * documentation gap, never "you were overcharged" (SPEC.md §2 rule 3). All functions are pure.
 */
import { longDate, usd } from "@/lib/format";
import type {
  ConfirmedBill,
  ConfirmedBillLine,
  ConfirmedEob,
  Finding,
  NonEmpty,
  Source,
  VerbatimFact,
} from "@/lib/types";
import { MATCH_WINDOW_DAYS, RECORD_LOOKUP } from "./lookup";

/**
 * Builds a bill-line source.
 *
 * @param bill - Confirmed bill.
 * @param line - The line.
 * @returns A `bill_line` source with provenance.
 */
function lineSource(bill: ConfirmedBill, line: ConfirmedBillLine): Source {
  return { kind: "bill_line", documentId: bill.documentId, lineNumber: line.lineNumber, provenance: line.provenance };
}

/**
 * The amount a line contributes to what the patient is asked to pay: patient responsibility when
 * printed, otherwise the charge.
 *
 * @param line - Confirmed line.
 * @returns Cents.
 */
function lineAmount(line: ConfirmedBillLine): number {
  return line.patientResponsibilityCents ?? line.chargeCents;
}

/**
 * Finds potential duplicate charges: same code, service date, amount, billing entity, and encounter
 * (all lines of one confirmed bill share entity and encounter). Quantity differences are not
 * duplicates, and similar descriptions alone never make a duplicate.
 *
 * @param bill - Confirmed bill.
 * @returns One finding per duplicate group, questioning every copy after the first; empty if none.
 * @example findDuplicateCharges(bill) // lines 3 and 5 (84443, 03/05, $68.00) → one finding
 */
export function findDuplicateCharges(bill: ConfirmedBill): Finding[] {
  const groups = new Map<string, ConfirmedBillLine[]>();
  for (const line of bill.lines) {
    if (!line.code || !line.serviceDate) continue;
    const key = `${line.code}|${line.serviceDate}|${line.chargeCents}|${line.quantity}`;
    groups.set(key, [...(groups.get(key) ?? []), line]);
  }
  const findings: Finding[] = [];
  for (const lines of groups.values()) {
    if (lines.length < 2) continue;
    const [first, ...extra] = lines;
    const nums = lines.map((l) => l.lineNumber);
    findings.push({
      id: `dup-${first.code}-${first.serviceDate}-${nums.join("-")}`,
      rule: "duplicate_charge",
      status: "potential",
      title: `Potential duplicate charge: lines ${nums.join(" and ")}`,
      explanation: `Lines ${nums.join(" and ")} have the same code (${first.code}), service date (${longDate(first.serviceDate as string)}), and charge (${usd(first.chargeCents)}) from ${bill.billingEntity} for the same visit. This may be a duplicate, or they may be separate services; only documentation can tell.`,
      ask: `Ask ${bill.billingEntity} to confirm whether line${extra.length > 1 ? "s" : ""} ${extra.map((l) => l.lineNumber).join(", ")} ${extra.length > 1 ? "are" : "is"} a duplicate and, if so, remove ${extra.length > 1 ? "them" : "it"}.`,
      amountQuestionedCents: extra.reduce((s, l) => s + lineAmount(l), 0),
      lineNumbers: extra.map((l) => l.lineNumber),
      sources: lines.map((l) => lineSource(bill, l)) as NonEmpty<Source>,
    });
  }
  return findings;
}

/**
 * Finds when the bill asks the patient for more than the EOB says they owe. Bill lines with no
 * matching EOB line (same code and date) are listed as the likely cause.
 *
 * @param bill - Confirmed bill.
 * @param eob - Confirmed EOB for the same visit, or `null`.
 * @returns At most one finding; empty when there is no EOB, a total is missing, or the bill doesn't exceed it.
 */
export function findBillExceedsEob(bill: ConfirmedBill, eob: ConfirmedEob | null): Finding[] {
  if (!eob || bill.amountDueCents === null || eob.totalPatientResponsibilityCents === null) return [];
  const diff = bill.amountDueCents - eob.totalPatientResponsibilityCents;
  if (diff <= 0) return [];

  const remaining = eob.lines.map((l) => `${l.code}|${l.serviceDate}`);
  const unmatched: ConfirmedBillLine[] = [];
  for (const line of bill.lines) {
    const i = remaining.indexOf(`${line.code}|${line.serviceDate}`);
    if (i === -1) unmatched.push(line);
    else remaining.splice(i, 1);
  }
  const cause = unmatched.length
    ? ` The bill has ${unmatched.length === 1 ? "a line" : "lines"} the EOB doesn't show: ${unmatched.map((l) => `line ${l.lineNumber} (${l.code}, ${usd(l.chargeCents)})`).join(", ")}.`
    : "";
  return [
    {
      id: "bill-exceeds-eob",
      rule: "bill_exceeds_eob",
      status: "potential",
      title: `The bill asks for ${usd(diff)} more than your EOB says you owe`,
      explanation: `${bill.billingEntity} says ${usd(bill.amountDueCents)} is due. Your EOB from ${eob.insurer ?? "your insurer"} (claim ${eob.claimNumber ?? "unknown"}) says you owe ${usd(eob.totalPatientResponsibilityCents)}.${cause} An EOB is not a bill, but the amount you owe should normally match it.`,
      ask: `Ask ${bill.billingEntity} to explain the ${usd(diff)} difference from the EOB and correct the balance if it was billed in error.`,
      amountQuestionedCents: diff,
      lineNumbers: unmatched.map((l) => l.lineNumber),
      sources: [
        { kind: "bill_total", documentId: bill.documentId, provenance: { page: null, snippet: `Amount due: ${usd(bill.amountDueCents)}` } },
        { kind: "eob_total", documentId: eob.documentId, provenance: { page: null, snippet: `Total you owe: ${usd(eob.totalPatientResponsibilityCents)}` } },
        ...unmatched.map((l) => lineSource(bill, l)),
      ],
    },
  ];
}

/**
 * Days between two ISO dates (absolute).
 *
 * @param a - ISO date.
 * @param b - ISO date.
 * @returns Whole days apart.
 */
function daysApart(a: string, b: string): number {
  return Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000;
}

/**
 * Whether a record is the kind of record a billing code expects, ignoring dates.
 *
 * @param r - Verbatim record.
 * @param code - Billing code.
 * @returns True when the category matches and the clinical code or text matches.
 */
function recordIsKind(r: VerbatimFact, code: string): boolean {
  const exp = RECORD_LOOKUP[code];
  if (!exp || r.category !== exp.category) return false;
  if (r.code && exp.codes.includes(r.code)) return true;
  const text = r.text.toLowerCase();
  return exp.textMatches.some((words) => words.every((w) => text.includes(w)));
}

/**
 * Whether a record matches a billing code's expectation on a service date.
 *
 * @param r - Verbatim record.
 * @param code - Billing code.
 * @param date - Service date (ISO).
 * @returns True when the record is the right kind and dated within the match window.
 */
function recordMatches(r: VerbatimFact, code: string, date: string): boolean {
  return recordIsKind(r, code) && daysApart(r.recordedAt, date) <= MATCH_WINDOW_DAYS;
}

/**
 * Finds lab and medication charges with no matching record (documentation gaps). Only codes in the
 * demo lookup are checked; a missing record is a reason to ask for documentation, not proof the
 * service didn't happen. When a record of the same kind exists outside the date window (often at
 * another provider), the closest one is cited verbatim, without saying what it means.
 *
 * @param bill - Confirmed bill.
 * @param records - The patient's records from every connected provider.
 * @param providers - Providers whose records were searched (for the citation).
 * @returns One finding per unmatched checkable line; empty when everything matches.
 */
export function findDocumentationGaps(bill: ConfirmedBill, records: VerbatimFact[], providers: string[]): Finding[] {
  const findings: Finding[] = [];
  for (const line of bill.lines) {
    if (!line.code || !line.serviceDate) continue;
    const exp = RECORD_LOOKUP[line.code];
    if (!exp) continue;
    if (records.some((r) => recordMatches(r, line.code as string, line.serviceDate as string))) continue;
    const checked = records.filter((r) => r.category === exp.category).length;
    const date = line.serviceDate;
    const closest = records
      .filter((r) => recordIsKind(r, line.code as string))
      .sort((a, b) => daysApart(a.recordedAt, date) - daysApart(b.recordedAt, date))[0];
    const days = closest ? daysApart(closest.recordedAt, date) : 0;
    const closestText = closest
      ? ` The closest ${exp.service} record is from ${closest.provider} on ${longDate(closest.recordedAt)}, ${days} day${days === 1 ? "" : "s"} ${closest.recordedAt < date ? "before" : "after"} the service date.`
      : "";
    findings.push({
      id: `gap-${line.lineNumber}-${line.code}`,
      rule: "documentation_gap",
      status: "potential",
      title: `No matching record for line ${line.lineNumber} (${exp.service})`,
      explanation: `Line ${line.lineNumber} charges ${usd(line.chargeCents)} for a ${exp.service} (${line.code}) on ${longDate(line.serviceDate)}, but none of your ${exp.category} records from ${providers.join(" or ")} within ${MATCH_WINDOW_DAYS} day of that date match it.${closestText} This doesn't prove the service didn't happen; your records may be incomplete.`,
      ask: `Ask ${bill.billingEntity} for documentation of this ${exp.service} (for example, the result or the order) before paying for line ${line.lineNumber}.`,
      amountQuestionedCents: lineAmount(line),
      lineNumbers: [line.lineNumber],
      sources: [
        lineSource(bill, line),
        {
          kind: "records_searched",
          providers,
          searched: `${exp.category} records matching ${line.code} (${exp.service}) dated ${line.serviceDate} ± ${MATCH_WINDOW_DAYS} day`,
          recordsChecked: checked,
        },
        ...(closest ? [{ kind: "record" as const, fact: closest }] : []),
      ],
    });
  }
  return findings;
}
