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
import { sameName } from "@/lib/cases/consistency";
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
export async function loadRecords(externalId?: string, patientName?: string | null): Promise<RecordsResult> {
  if (!isMockMode()) return forPatient(await loadLiveRecords({ externalId }), patientName);
  const saved = mapSnapshot(JSON.parse(readFileSync(savedSnapshotPath(), "utf8")));
  return forPatient(
    { records: saved.records, providers: providersOf(saved.records), origin: "saved-snapshot", subject: "patient-demo-multi-source", patientName: saved.patientName, warnings: [] },
    patientName,
  );
}

/**
 * Drops records that belong to someone else: FinchNode's synthetic sandbox has one patient, so a
 * case for a different person (by name on the bill or letter) must not be checked against them.
 * Pure.
 *
 * @param result - Records as loaded.
 * @param patientName - The case's patient (bill or denial letter), or null/undefined to skip the check.
 * @returns The same result, or one with no records and a plain warning when the names differ.
 */
export function forPatient(result: RecordsResult, patientName?: string | null): RecordsResult {
  if (!patientName || !result.patientName || sameName(patientName, result.patientName)) return result;
  return {
    ...result,
    records: [],
    providers: [],
    warnings: [...result.warnings, `The connected FinchNode records belong to a different patient, so none were used for ${patientName}.`],
  };
}
