/**
 * @file Turns transcribed raw text into normalized values (SPEC.md §4.2 step 2).
 *
 * Money becomes integer cents, dates become ISO 8601, codes are trimmed. A value that cannot be
 * parsed stays `null` and the field is flagged; nothing is guessed. All functions are pure.
 */
import type { Cents, CodeType, Field, IsoDate, ProviderType } from "@/lib/types";
import type { RawField } from "./schemas";

/**
 * Parses a printed money amount into integer cents.
 *
 * Accepts "$1,234.56", "1234.56", "-$524.00", "($524.00)", "524.00 CR". Rejects anything with more
 * than two decimals or stray characters.
 *
 * @param raw - Amount as printed.
 * @returns Cents (negative for credits), or `null` if it cannot be parsed.
 * @example parseMoney("-$524.00") // -52400
 */
export function parseMoney(raw: string): Cents | null {
  let s = raw.trim();
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  if (/\s*CR$/i.test(s)) {
    negative = true;
    s = s.replace(/\s*CR$/i, "");
  }
  if (s.startsWith("-")) {
    negative = !negative;
    s = s.slice(1);
  }
  s = s.replace(/^\$/, "").replace(/,/g, "").trim();
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const [whole, frac = ""] = s.split(".");
  const cents = Number(whole) * 100 + Number(frac.padEnd(2, "0"));
  return negative ? -cents : cents;
}

/**
 * Parses a printed date into ISO 8601 (YYYY-MM-DD).
 *
 * Accepts MM/DD/YYYY, M/D/YYYY, MM-DD-YYYY, YYYY-MM-DD. Rejects impossible dates (e.g. 02/30).
 *
 * @param raw - Date as printed.
 * @returns ISO date, or `null` if it cannot be parsed.
 * @example parseDate("09/14/2026") // "2026-09-14"
 */
export function parseDate(raw: string): IsoDate | null {
  const s = raw.trim();
  let y: number, m: number, d: number;
  let match = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (match) {
    [m, d, y] = [Number(match[1]), Number(match[2]), Number(match[3])];
  } else if ((match = s.match(/^(\d{4})-(\d{2})-(\d{2})$/))) {
    [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  } else {
    return null;
  }
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/**
 * Parses a printed whole number (quantities, line numbers).
 *
 * @param raw - Number as printed.
 * @returns The integer, or `null` if it is not a non-negative whole number.
 */
export function parseInteger(raw: string): number | null {
  const s = raw.trim().replace(/,/g, "");
  return /^\d+$/.test(s) ? Number(s) : null;
}

/**
 * Normalizes a code-type label.
 *
 * @param raw - Label as returned (e.g. "CPT", "hcpcs", "Revenue").
 * @returns The code type, or `null` if unrecognized.
 */
export function parseCodeType(raw: string): CodeType | null {
  const s = raw.trim().toUpperCase();
  if (s === "CPT") return "CPT";
  if (s === "HCPCS") return "HCPCS";
  if (s === "REV" || s.startsWith("REVENUE")) return "REV";
  if (s === "NDC") return "NDC";
  if (s === "UNKNOWN") return "unknown";
  return null;
}

/**
 * Normalizes a provider-type label.
 *
 * @param raw - Label as returned.
 * @returns The provider type, or `null` if unrecognized.
 */
export function parseProviderType(raw: string): ProviderType | null {
  const s = raw.trim().toLowerCase();
  if (s === "other") return s;
  // Models sometimes copy a printed heading ("Facility charges", "Professional fees") as the label.
  if (/^(facility|hospital)\b/.test(s)) return "facility";
  if (/^(clinician|physician|professional)\b/.test(s)) return "clinician";
  return null;
}

/**
 * Infers a code type from a code's format when the document doesn't label it. Format only: CPT is
 * 5 digits (or 4 digits plus F/T/U); HCPCS Level II is a letter A–V plus 4 digits.
 *
 * Pure: no side effects.
 *
 * @param code - Normalized (upper-case) billing code.
 * @returns "CPT" or "HCPCS", or `null` when the format is ambiguous (revenue codes and NDCs are never guessed).
 * @example inferCodeType("80053") // "CPT"
 */
export function inferCodeType(code: string): CodeType | null {
  if (/^\d{4}[0-9FTU]$/.test(code)) return "CPT";
  if (/^[A-V]\d{4}$/.test(code)) return "HCPCS";
  return null;
}

/**
 * Builds a `Field` from a raw field using a parser.
 *
 * If the raw value is present but the parser rejects it, the value is `null` and the field gets an
 * issue (it will need attention). Checks run later may add more issues.
 *
 * @param raw - Transcribed field from the model.
 * @param parse - Parser for the normalized type.
 * @param label - Human label used in issue messages, e.g. "Line 4 charge".
 * @returns The normalized field (verification provisional until checks run).
 */
export function toField<T>(raw: RawField, parse: (s: string) => T | null, label: string): Field<T> {
  const issues: string[] = [];
  let value: T | null = null;
  if (raw.status === "read" && raw.raw !== null) {
    value = parse(raw.raw);
    if (value === null) issues.push(`${label}: "${raw.raw}" could not be read as a valid value`);
  } else if (raw.status === "unreadable") {
    issues.push(`${label}: unreadable on the document [to confirm]`);
  }
  return {
    raw: raw.raw,
    value,
    page: raw.page,
    snippet: raw.snippet,
    status: raw.status,
    verification: issues.length ? "needs_attention" : "verified",
    issues,
  };
}

/**
 * Identity parser for free text: trims and rejects empty strings.
 *
 * @param raw - Text as printed.
 * @returns Trimmed text, or `null` when empty.
 */
export function parseText(raw: string): string | null {
  const s = raw.trim().replace(/\s+/g, " ");
  return s.length ? s : null;
}
