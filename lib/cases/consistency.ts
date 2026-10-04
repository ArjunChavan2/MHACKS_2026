/**
 * @file Do two documents belong to the same visit? (SPEC.md §4.2, §4.6; GitHub issue #5.) Pure; no LLM.
 *
 * The audit compares a bill with an EOB, and verification compares a revised statement with the
 * original bill. Both comparisons are meaningless across different visits, so these checks run
 * first and say plainly what doesn't match. A value missing on either side can't be compared and is
 * not treated as a mismatch. Matching tolerates how the same thing is printed differently
 * ("DOE, JANE" ~ "Jane Q. Doe", "QUILLHAVEN MED GRP" ~ "Quillhaven Medical Group", a masked
 * "XXXX5518" ~ "QMG-305518"), so a real match is never refused.
 */
import type { ConfirmedBill, ConfirmedEob } from "@/lib/types";

/** Name words that say nothing about who a person is (titles, suffixes). */
const NAME_NOISE = new Set(["mr", "mrs", "ms", "miss", "dr", "jr", "sr", "ii", "iii", "iv"]);

/** Provider name words too generic to tell two providers apart. */
const PROVIDER_NOISE = new Set([
  "the", "of", "and", "at", "for", "inc", "llc", "llp", "pc", "pa", "pllc", "corp", "co", "ltd",
  "medical", "medicine", "health", "healthcare", "hospital", "hospitals", "center", "centre",
  "clinic", "clinics", "group", "system", "systems", "services", "physician", "physicians",
  "associates", "partners", "billing", "office", "department", "dept", "care", "practice",
  "university", "community", "regional", "md", "do", "dr",
]);

/**
 * Lower-case word tokens, accents removed, ignoring punctuation and "(Synthetic)"-style labels.
 *
 * @param s - Text.
 * @returns Words in order.
 */
function words(s: string): string[] {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\(.*?\)/g, " ")
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/**
 * Whether two printed person names can be the same person: every meaningful word (initials,
 * titles, and suffixes ignored) of the shorter name appears in the longer one, in any order.
 *
 * @param a - Name.
 * @param b - Name.
 * @returns True when they can match, or when either has no meaningful word.
 * @example sameName("RAMASWAMY, PRIYA", "Ms. Priya S. Ramaswamy") // true
 */
export function sameName(a: string, b: string): boolean {
  const key = (s: string) => new Set(words(s).filter((w) => w.length > 1 && !NAME_NOISE.has(w)));
  const [x, y] = [key(a), key(b)].sort((p, q) => p.size - q.size);
  return x.size === 0 || [...x].every((w) => y.has(w));
}

/**
 * Whether two printed provider names can be the same provider: they share at least one
 * distinctive word (generic words like "Medical", "Group", or "Inc" don't count).
 *
 * @param a - Provider name.
 * @param b - Provider name.
 * @returns True when they share a distinctive word, or when either has none.
 * @example sameProvider("Quillhaven Medical Group", "QUILLHAVEN MED GRP") // true
 */
export function sameProvider(a: string, b: string): boolean {
  const key = (s: string) => new Set(words(s).filter((w) => w.length > 1 && !PROVIDER_NOISE.has(w)));
  const x = key(a);
  const y = key(b);
  return x.size === 0 || y.size === 0 || [...x].some((w) => y.has(w));
}

/**
 * Whether two account numbers can be the same account. Spaces, dashes, case, and a leading mask
 * ("XXXX", "****") are ignored; a shorter number of at least 4 characters matches the end of a
 * longer one (statements often print only the last digits or drop a prefix).
 *
 * @param a - Account number.
 * @param b - Account number.
 * @returns True when they can match, or when either has nothing left to compare.
 * @example sameAccount("QMG-305518", "xxxx5518") // true
 */
export function sameAccount(a: string, b: string): boolean {
  const key = (s: string) => s.toUpperCase().replace(/^[X*•\s-]+/, "").replace(/[^A-Z0-9]/g, "");
  const [x, y] = [key(a), key(b)].sort((p, q) => p.length - q.length);
  if (!x.length) return true;
  return x === y || (x.length >= 4 && y.endsWith(x));
}

/**
 * Checks that an EOB is for the same visit as the bill: same patient, account (if the EOB prints
 * one), and provider, and at least one EOB line dated within the bill's service dates.
 *
 * @param bill - Confirmed bill.
 * @param eob - Confirmed EOB.
 * @returns Plain-language mismatches; empty when they belong together (or can't be compared).
 */
export function billEobMismatches(bill: ConfirmedBill, eob: ConfirmedEob): string[] {
  const out: string[] = [];
  // patientName/accountNumber are missing on EOBs confirmed before they were extracted.
  if (eob.patientName && bill.patientName && !sameName(eob.patientName, bill.patientName)) {
    out.push(`The EOB is for ${eob.patientName}, but the bill is for ${bill.patientName}.`);
  }
  if (eob.accountNumber && bill.accountNumber && !sameAccount(eob.accountNumber, bill.accountNumber)) {
    out.push(`The EOB's account number (${eob.accountNumber}) doesn't match the bill (${bill.accountNumber}).`);
  }
  if (eob.provider && bill.billingEntity && !sameProvider(eob.provider, bill.billingEntity)) {
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
  if (original.billingEntity && revised.billingEntity && !sameProvider(original.billingEntity, revised.billingEntity)) {
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
