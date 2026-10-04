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
import { sameName } from "@/lib/cases/consistency";
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
      letterText: `Lines ${nums.join(" and ")} show the same code (${first.code}), service date (${longDate(first.serviceDate as string)}), and charge (${usd(first.chargeCents)}). Please confirm whether line${extra.length > 1 ? "s" : ""} ${extra.map((l) => l.lineNumber).join(", ")} ${extra.length > 1 ? "are duplicates" : "is a duplicate"} and, if so, remove ${extra.length > 1 ? "them" : "it"} from my bill.`,
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
      letterText: `The bill shows ${usd(bill.amountDueCents)} due, but my explanation of benefits from ${eob.insurer ?? "my insurer"} (claim ${eob.claimNumber ?? "number not shown"}) shows ${usd(eob.totalPatientResponsibilityCents)} as my responsibility, a difference of ${usd(diff)}.${unmatched.length ? ` ${unmatched.length === 1 ? "This line does" : "These lines do"} not appear on the EOB: ${unmatched.map((l) => `line ${l.lineNumber} (${l.code}, ${usd(l.chargeCents)})`).join(", ")}.` : ""} Please explain the difference and correct the balance if it was billed in error.`,
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
 * @returns One finding per unmatched checkable line; empty when everything matches or no records were searched.
 */
export function findDocumentationGaps(bill: ConfirmedBill, records: VerbatimFact[], providers: string[]): Finding[] {
  // No provider's records were searched (none connected, or they belong to someone else): nothing to compare.
  if (!providers.length) return [];
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
      letterText: `Line ${line.lineNumber} charges ${usd(line.chargeCents)} for a ${exp.service} (${line.code}) on ${longDate(line.serviceDate)}. My ${exp.category} records from ${providers.join(" and ")} show no matching result within ${MATCH_WINDOW_DAYS} day of that date.${closest ? ` The closest is from ${closest.provider} on ${longDate(closest.recordedAt)}.` : ""} Please send documentation of this ${exp.service}, such as the result or the order, before I pay for line ${line.lineNumber}.`,
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

/** Visit codes (office/outpatient, hospital, consults, emergency) that need a visit on record that day. */
const VISIT_CODE = /^99(20[2-5]|21[1-5]|22[1-3]|23[1-9]|24[1-5]|28[1-5])$/;
/** Specimen collection codes that need a lab result from that day. */
const DRAW_CODES = new Set(["36415"]);

/**
 * Whether a code is in the CPT surgery range (10000–69999).
 *
 * @param code - Billing code as printed.
 * @returns True for five-digit codes in that range.
 */
function isProcedureCode(code: string): boolean {
  return /^\d{5}$/.test(code) && Number(code) >= 10000 && Number(code) <= 69999;
}

/**
 * Checks bill lines the lab/medication lookup doesn't cover against the rest of the records, at the
 * billing provider only: a visit code needs a visit (encounter) that day, a blood draw needs a lab
 * result that day, and a procedure is reported with the visits recorded that day, since FinchNode
 * carries no procedure records. Lines are skipped when the billing provider's records aren't
 * connected (nothing to compare). Records are quoted verbatim; a missing record is a reason to ask
 * for documentation, not proof the service didn't happen.
 *
 * @param bill - Confirmed bill.
 * @param records - The patient's records from every connected provider.
 * @returns One finding per line that the billing provider's records don't support.
 */
export function findServicesWithoutRecord(bill: ConfirmedBill, records: VerbatimFact[]): Finding[] {
  const atProvider = records.filter((r) => sameName(r.provider, bill.billingEntity));
  if (!atProvider.length) return [];
  const provider = atProvider[0].provider;
  const near = (r: VerbatimFact, date: string) => daysApart(r.recordedAt, date) <= MATCH_WINDOW_DAYS;
  const visitsOn = (date: string) => atProvider.filter((r) => r.category === "encounter" && near(r, date));
  const quote = (rs: VerbatimFact[]) => rs.map((r) => `"${r.text}" (${longDate(r.recordedAt)})`).join(", ");
  const findings: Finding[] = [];
  for (const line of bill.lines) {
    const code = line.code;
    const date = line.serviceDate;
    if (!code || !date || RECORD_LOOKUP[code]) continue;
    const what = `${line.description ? `${line.description} ` : ""}(${code})`;
    const visits = visitsOn(date);
    let explanation: string;
    let letterText: string;
    let searched: string;
    let cite: VerbatimFact[] = [];
    if (VISIT_CODE.test(code)) {
      if (visits.length) continue;
      const closest = atProvider.filter((r) => r.category === "encounter").sort((a, b) => daysApart(a.recordedAt, date) - daysApart(b.recordedAt, date))[0];
      cite = closest ? [closest] : [];
      searched = `visit records dated ${date} ± ${MATCH_WINDOW_DAYS} day`;
      explanation = `Line ${line.lineNumber} charges ${usd(line.chargeCents)} for a visit, ${what}, on ${longDate(date)}, but your records from ${provider} show no visit within ${MATCH_WINDOW_DAYS} day of that date.${closest ? ` The closest visit on record is ${quote([closest])}.` : ""} This doesn't prove the visit didn't happen; your records may be incomplete.`;
      letterText = `Line ${line.lineNumber} charges ${usd(line.chargeCents)} for ${what} on ${longDate(date)}. My records from ${provider} show no visit on that date. Please send the visit note or other documentation of this visit before I pay for line ${line.lineNumber}.`;
    } else if (DRAW_CODES.has(code)) {
      if (atProvider.some((r) => r.category === "lab" && near(r, date))) continue;
      searched = `lab results dated ${date} ± ${MATCH_WINDOW_DAYS} day`;
      explanation = `Line ${line.lineNumber} charges ${usd(line.chargeCents)} for a blood draw, ${what}, on ${longDate(date)}, but your records from ${provider} show no lab result within ${MATCH_WINDOW_DAYS} day of that date. This doesn't prove it didn't happen; your records may be incomplete.`;
      letterText = `Line ${line.lineNumber} charges ${usd(line.chargeCents)} for ${what} on ${longDate(date)}. My records from ${provider} show no lab result from that date. Please send documentation of the tests this sample was drawn for before I pay for line ${line.lineNumber}.`;
    } else if (isProcedureCode(code)) {
      cite = visits;
      searched = `procedure and visit records dated ${date} ± ${MATCH_WINDOW_DAYS} day`;
      const seen = visits.length ? `The only visit${visits.length > 1 ? "s" : ""} recorded that day: ${quote(visits)}.` : "There is no visit recorded that day.";
      explanation = `Line ${line.lineNumber} charges ${usd(line.chargeCents)} for a procedure, ${what}, on ${longDate(date)}. None of your records from ${provider} mention this procedure. ${seen} This doesn't prove it didn't happen; ask for the operative or procedure report before paying.`;
      letterText = `Line ${line.lineNumber} charges ${usd(line.chargeCents)} for ${what} on ${longDate(date)}. My records from ${provider} contain no record of this procedure${visits.length ? `; the only visit recorded that day is ${quote(visits)}` : " and no visit on that date"}. Please send the operative or procedure report for this charge, or remove it, before I pay for line ${line.lineNumber}.`;
    } else continue;
    findings.push({
      id: `norecord-${line.lineNumber}-${code}`,
      rule: "service_without_record",
      status: "potential",
      title: `No record of line ${line.lineNumber} (${line.description ?? code}) in your records`,
      explanation,
      ask: `Ask ${bill.billingEntity} for documentation of line ${line.lineNumber} before paying for it.`,
      letterText,
      amountQuestionedCents: lineAmount(line),
      lineNumbers: [line.lineNumber],
      sources: [
        lineSource(bill, line),
        { kind: "records_searched", providers: [provider], searched, recordsChecked: atProvider.length },
        ...cite.map((fact) => ({ kind: "record" as const, fact })),
      ],
    });
  }
  return findings;
}

/**
 * Finds EOB lines the insurer paid nothing for while the patient is charged the full billed amount
 * (a denial or non-covered line). The provider billed what the EOB says, so this is for the insurer:
 * ask it to explain, reprocess, or start an appeal (SPEC.md §3.4 "insurance appeal").
 *
 * @param bill - Confirmed bill (for line numbers).
 * @param eob - Confirmed EOB, or `null`.
 * @returns One finding per such line, marked `contact: "insurer"`; empty when none or no EOB.
 */
export function findInsurerDenials(bill: ConfirmedBill, eob: ConfirmedEob | null): Finding[] {
  if (!eob) return [];
  const insurer = eob.insurer ?? "your insurer";
  const findings: Finding[] = [];
  eob.lines.forEach((l, i) => {
    const billed = l.billedCents ?? 0;
    if (billed <= 0 || l.planPaidCents !== 0 || (l.allowedCents ?? 0) !== 0 || l.patientResponsibilityCents !== billed) return;
    const line = bill.lines.find((b) => b.code === l.code && b.serviceDate === l.serviceDate);
    const where = line ? `line ${line.lineNumber}` : `EOB line ${i + 1}`;
    findings.push({
      id: `ins-denied-${l.code ?? i}-${l.serviceDate ?? "nodate"}`,
      rule: "insurer_denied_line",
      status: "potential",
      contact: "insurer",
      title: `${insurer} paid nothing for ${where} (${l.code ?? "no code"}, ${usd(billed)})`,
      explanation: `Your EOB from ${insurer} (claim ${eob.claimNumber ?? "unknown"}) shows $0 allowed and $0 paid for ${l.code ?? "this service"} on ${l.serviceDate ? longDate(l.serviceDate) : "the service date"}, so you're asked to pay the full ${usd(billed)}. The provider billed what the EOB says, so this is a question for your insurer, not the billing office.`,
      ask: `Ask ${insurer} why it paid nothing for this service, whether it can be reprocessed, and how to appeal if it was denied.`,
      letterText: `My explanation of benefits (claim ${eob.claimNumber ?? "number not shown"}) shows $0 allowed and $0 paid for ${l.code ?? "this service"} on ${l.serviceDate ? longDate(l.serviceDate) : "the service date"}, leaving ${usd(billed)} as my responsibility. Please explain why, reprocess the claim if it was processed in error, or tell me how to appeal.`,
      amountQuestionedCents: billed,
      lineNumbers: line ? [line.lineNumber] : [],
      sources: [{ kind: "eob_line", documentId: eob.documentId, index: i, provenance: l.provenance }, ...(line ? [lineSource(bill, line)] : [])] as NonEmpty<Source>,
    });
  });
  return findings;
}
