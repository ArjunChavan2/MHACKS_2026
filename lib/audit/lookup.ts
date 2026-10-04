/**
 * @file Billing-code → record lookup for the documentation-gap rule (SPEC.md §4.3, §7 O9).
 *
 * Maps a few billing codes on the demo bill to what a matching FinchNode record looks like. DEMO
 * CODES ONLY, not a clinical reference. Add a row only after checking the codes against a reliable
 * source; never guess a mapping.
 */
import type { RecordCategory } from "@/lib/types";

/** What a matching record looks like for one billing code. */
export interface RecordExpectation {
  /** Human description of the service, used in messages. */
  service: string;
  /** Record category to search. */
  category: RecordCategory;
  /** Clinical codes that count as a match (e.g. LOINC for labs). */
  codes: string[];
  /** Lower-case words; a record whose text contains all of one entry's words also matches. */
  textMatches: string[][];
}

/**
 * Demo lookup. Keys are billing codes as printed (upper case).
 * - 80053 Comprehensive metabolic panel → LOINC 24323-8
 * - 85025 CBC with automated differential → LOINC 58410-2 (CBC panel, automated count)
 * - 84484 Troponin, quantitative → LOINC 10839-9 (troponin I) or 6598-7 (troponin T)
 * - 80061 Lipid panel → LOINC 57698-3
 * - J1885 Ketorolac injection, per 15 mg → medication record mentioning ketorolac
 * - 84443 Thyroid stimulating hormone (TSH) → LOINC 3016-3 (thyrotropin, serum or plasma)
 * - 84439 Thyroxine, free → LOINC 3024-7 (free T4, serum or plasma)
 * - 82728 Ferritin → LOINC 2276-4
 * - 85018 Hemoglobin → LOINC 718-7 (hemoglobin, blood)
 * The last four cover the FinchNode demo patient's labs (SPEC.md §7.2 spike results).
 */
export const RECORD_LOOKUP: Readonly<Record<string, RecordExpectation>> = Object.freeze({
  "80053": { service: "comprehensive metabolic panel", category: "lab", codes: ["24323-8"], textMatches: [["comprehensive", "metabolic"]] },
  "85025": { service: "complete blood count", category: "lab", codes: ["58410-2"], textMatches: [["cbc"], ["complete", "blood", "count"]] },
  "84484": { service: "troponin test", category: "lab", codes: ["10839-9", "6598-7"], textMatches: [["troponin"]] },
  "80061": { service: "lipid panel", category: "lab", codes: ["57698-3"], textMatches: [["lipid"]] },
  J1885: { service: "ketorolac injection", category: "medication", codes: [], textMatches: [["ketorolac"]] },
  "84443": { service: "TSH test", category: "lab", codes: ["3016-3"], textMatches: [["thyrotropin"]] },
  "84439": { service: "free T4 test", category: "lab", codes: ["3024-7"], textMatches: [["thyroxine", "free"]] },
  "82728": { service: "ferritin test", category: "lab", codes: ["2276-4"], textMatches: [["ferritin"]] },
  "85018": { service: "hemoglobin test", category: "lab", codes: ["718-7"], textMatches: [["hemoglobin", "mass", "blood"]] },
});

/** How many days before or after the service date a record may be dated and still match. */
export const MATCH_WINDOW_DAYS = 1;
