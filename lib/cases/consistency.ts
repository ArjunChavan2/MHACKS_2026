/**
 * @file Do two documents belong to the same visit? (SPEC.md §4.2, §4.6.) Pure; no LLM.
 *
 * The audit compares a bill with an EOB, and verification compares a revised statement with the
 * original bill. Both comparisons are meaningless across different visits, so these checks run
 * first and say plainly what doesn't match. A value missing on either side can't be compared and is
 * not treated as a mismatch.
 */
import type { ConfirmedBill, ConfirmedEob } from "@/lib/types";

/**
 * Lower-case word tokens, ignoring punctuation and "(Synthetic)"-style labels.
 *
 * @param s - Text.
 * @returns Set of words.
 */
function words(s: string): Set<string> {
  return new Set(s.toLowerCase().replace(/\(.*?\)/g, " ").split(/[^a-z0-9]+/).filter(Boolean));
}

/**
 * Whether two organization or person names refer to the same entity: every word of the shorter
 * name appears in the longer one ("Quillhaven Medical Group" ~ "Quillhaven Medical Group, LLC").
 *
 * @param a - Name.
 * @param b - Name.
 * @returns True when they match.
 */
export function sameName(a: string, b: string): boolean {
  const [x, y] = [words(a), words(b)];
  const [short, long] = x.size <= y.size ? [x, y] : [y, x];
  return short.size > 0 && [...short].every((w) => long.has(w));
}

/**
 * Whether two account numbers match, ignoring spaces, dashes, and case.
 *
 * @param a - Account number.
 * @param b - Account number.
 * @returns True when they match.
 */
export function sameAccount(a: string, b: string): boolean {
  const norm = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return norm(a) === norm(b);
}

/**
 * Checks that an EOB is for the same visit as the bill: same provider, and at least one EOB line
 * dated within the bill's service dates.
 *
 * @param bill - Confirmed bill.
 * @param eob - Confirmed EOB.
 * @returns Plain-language mismatches; empty when they belong together (or can't be compared).
 */
export function billEobMismatches(bill: ConfirmedBill, eob: ConfirmedEob): string[] {
  const out: string[] = [];
  if (eob.provider && bill.billingEntity && !sameName(eob.provider, bill.billingEntity)) {
    out.push(`The EOB is for ${eob.provider}, but the bill is from ${bill.billingEntity}.`);
  }
  const start = bill.serviceStart;
  const end = bill.serviceEnd ?? bill.serviceStart;
  const dates = eob.lines.map((l) => l.serviceDate).filter((d): d is string => Boolean(d));
  if (start && end && dates.length && !dates.some((d) => d >= start && d <= end)) {
    out.push(`None of the EOB's service dates (${[...new Set(dates)].join(", ")}) fall within the bill's service dates (${start === end ? start : `${start} to ${end}`}).`);
  }
  return out;
}

/**
 * Checks that a revised statement is for the same account as the original bill: same provider,
 * account number, and patient.
 *
 * @param original - Confirmed original bill.
 * @param revised - Confirmed (or about to be confirmed) revised statement.
 * @returns Plain-language mismatches; empty when they belong together (or can't be compared).
 */
export function revisedMismatches(original: ConfirmedBill, revised: ConfirmedBill): string[] {
  const out: string[] = [];
  if (original.billingEntity && revised.billingEntity && !sameName(original.billingEntity, revised.billingEntity)) {
    out.push(`The revised statement is from ${revised.billingEntity}, but the original bill is from ${original.billingEntity}.`);
  }
  if (original.accountNumber && revised.accountNumber && !sameAccount(original.accountNumber, revised.accountNumber)) {
    out.push(`The revised statement's account number (${revised.accountNumber}) doesn't match the original bill (${original.accountNumber}).`);
  }
  if (original.patientName && revised.patientName && !sameName(original.patientName, revised.patientName)) {
    out.push(`The revised statement is for ${revised.patientName}, but the original bill is for ${original.patientName}.`);
  }
  return out;
}
