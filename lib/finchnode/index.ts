/**
 * @file The only code that talks to FinchNode (SPEC.md §4.1, §5.3).
 *
 * `USE_MOCK=true` (default) serves the saved sample records in `fixtures/records.json`, which match
 * the sample bill. `USE_MOCK=false` loads real FinchNode synthetic records through `./live.ts`
 * (sandbox Connect, then the demo API, then a saved snapshot). This directory is the only place
 * `VerbatimFact` objects are created (SPEC.md §5.6).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import type { VerbatimFact } from "@/lib/types";
import { loadLiveRecords, type RecordsResult } from "./live";

export { FinchNodeError, loadLiveRecords, mapRecord, mapSnapshot, type RecordsOrigin, type RecordsResult } from "./live";

/** Shape of one saved record in `fixtures/records.json`. */
const RecordSchema = z.object({
  recordId: z.string().min(1),
  category: z.enum(["lab", "medication", "condition", "immunization", "other"]),
  text: z.string().min(1),
  code: z.string().nullable(),
  codeSystem: z.string().nullable(),
  recordedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  provider: z.string().min(1),
});

/** Shape of `fixtures/records.json`. */
const RecordsFileSchema = z.object({ records: z.array(RecordSchema) });

/**
 * Whether to serve saved sandbox data instead of calling FinchNode.
 *
 * @returns `true` unless `USE_MOCK` is explicitly "false".
 */
export function isMockMode(): boolean {
  return process.env.USE_MOCK !== "false";
}

/**
 * Returns the saved sample records (matched to the sample bill) as verbatim facts.
 *
 * Validates the saved file with zod and freezes each fact so downstream code cannot alter a health
 * fact. Side effects: reads `fixtures/records.json` from disk.
 *
 * @returns All sample records, in file order.
 * @throws {z.ZodError} When the saved records file does not match the expected shape.
 */
export function getRecords(): VerbatimFact[] {
  const file = JSON.parse(readFileSync(join(process.cwd(), "fixtures", "records.json"), "utf8"));
  return RecordsFileSchema.parse(file).records.map((r) => Object.freeze({ ...r }));
}

/**
 * Lists the distinct providers present in a set of records.
 *
 * Pure: no side effects.
 *
 * @param records - Verbatim facts.
 * @returns Provider names in first-seen order; empty when there are no records.
 */
export function providersOf(records: VerbatimFact[]): string[] {
  return [...new Set(records.map((r) => r.provider))];
}

/**
 * Loads the patient's records for an audit: the saved sample records in mock mode, otherwise real
 * FinchNode synthetic records (see `loadLiveRecords` for the fallback order).
 *
 * Side effects: reads fixtures, or network calls to FinchNode when `USE_MOCK=false`.
 *
 * @param externalId - Our identifier for a new sandbox Connect session (e.g. the case ID).
 * @returns Records with providers, origin, and warnings.
 */
export async function loadRecords(externalId?: string): Promise<RecordsResult> {
  if (!isMockMode()) return loadLiveRecords({ externalId });
  const records = getRecords();
  return { records, providers: providersOf(records), origin: "sample-fixture", subject: "sample", warnings: [] };
}
