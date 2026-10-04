/**
 * @file The only code that talks to FinchNode (SPEC.md §4.1, §5.3).
 *
 * MVP 1 serves saved synthetic records from `fixtures/records.json` (the `USE_MOCK` path). The
 * live FinchNode client lands in MVP 2 after the data-fit spike (SPEC.md §7.2) confirms the real
 * response schema. This module is the only place `VerbatimFact` objects are created (SPEC.md §5.6).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import type { VerbatimFact } from "@/lib/types";

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

/** Thrown when live FinchNode access is requested before the live client exists. */
export class FinchNodeLiveNotImplementedError extends Error {
  constructor() {
    super("Live FinchNode access is part of MVP 2 (SPEC.md §6). Set USE_MOCK=true for MVP 1.");
    this.name = "FinchNodeLiveNotImplementedError";
  }
}

/**
 * Whether to serve saved sandbox data instead of calling FinchNode.
 *
 * @returns `true` unless `USE_MOCK` is explicitly "false".
 */
export function isMockMode(): boolean {
  return process.env.USE_MOCK !== "false";
}

/**
 * Returns the patient's records as verbatim facts with provenance.
 *
 * Validates the saved file with zod and freezes each fact so downstream code cannot alter a health
 * fact. Side effects: reads `fixtures/records.json` from disk.
 *
 * @returns All records for the demo patient, in file order.
 * @throws {FinchNodeLiveNotImplementedError} When `USE_MOCK=false` (live client not built yet).
 * @throws {z.ZodError} When the saved records file does not match the expected shape.
 */
export function getRecords(): VerbatimFact[] {
  if (!isMockMode()) throw new FinchNodeLiveNotImplementedError();
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
