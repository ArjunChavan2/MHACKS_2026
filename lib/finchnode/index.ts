/**
 * @file The only code that talks to FinchNode (SPEC.md §4.1, §5.3).
 *
 * `USE_MOCK=true` (default) serves FinchNode's own synthetic records for the demo patient, saved in
 * `fixtures/finchnode/multi-source-overlap.json` (the sample bill is written around them).
 * `USE_MOCK=false` loads the same patient live through `./live.ts` (sandbox Connect, then the demo
 * API, then the saved snapshot). This directory is the only place `VerbatimFact` objects are created
 * (SPEC.md §5.6).
 */
import { readFileSync } from "node:fs";
import type { VerbatimFact } from "@/lib/types";
import { loadLiveRecords, mapSnapshot, savedSnapshotPath, type RecordsResult } from "./live";

export { FinchNodeError, loadLiveRecords, mapRecord, mapSnapshot, type RecordsOrigin, type RecordsResult } from "./live";

/**
 * Whether to serve saved sandbox data instead of calling FinchNode.
 *
 * @returns `true` unless `USE_MOCK` is explicitly "false".
 */
export function isMockMode(): boolean {
  return process.env.USE_MOCK !== "false";
}

/**
 * Returns the demo patient's saved FinchNode records as verbatim facts.
 *
 * Side effects: reads the saved snapshot from disk.
 *
 * @returns Facts from both providers, in snapshot order (each frozen).
 * @throws {import("./live").FinchNodeError} When the saved file is not a records snapshot.
 */
export function getRecords(): VerbatimFact[] {
  return mapSnapshot(JSON.parse(readFileSync(savedSnapshotPath(), "utf8"))).records;
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
 * Loads the patient's records for an audit: the saved snapshot in mock mode, otherwise real
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
  return { records, providers: providersOf(records), origin: "saved-snapshot", subject: "patient-demo-multi-source", warnings: [] };
}
