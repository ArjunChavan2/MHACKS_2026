/**
 * @file Plain-language descriptions of finding and letter sources, shared by the audit, letter,
 * and case screens. Text only; never adds facts beyond what the source holds.
 */
import type { Source } from "@/lib/types";

/**
 * Describes a source for the evidence view.
 *
 * @param s - Source.
 * @returns Plain-language description.
 */
export function describeSource(s: Source): string {
  switch (s.kind) {
    case "bill_line":
      return `Bill line ${s.lineNumber}${s.provenance.page ? `, page ${s.provenance.page}` : ""}: “${s.provenance.snippet ?? ""}”`;
    case "eob_line":
      return `EOB line ${s.index + 1}: “${s.provenance.snippet ?? ""}”`;
    case "eob_total":
      return `EOB: “${s.provenance.snippet ?? ""}”`;
    case "bill_total":
      return `Bill: “${s.provenance.snippet ?? ""}”`;
    case "record":
      return `${s.fact.provider}, ${s.fact.recordedAt}: “${s.fact.text}” (record ${s.fact.recordId})`;
    case "records_searched":
      return `Searched ${s.recordsChecked} records from ${s.providers.join(" and ")}: ${s.searched}. No match.`;
    case "response":
      return `Response from ${s.from}, ${s.receivedAt}${s.note ? `: “${s.note}”` : ""}`;
    case "document":
      return `Document: ${s.label}`;
  }
}
