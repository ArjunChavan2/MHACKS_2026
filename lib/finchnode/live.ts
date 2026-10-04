/**
 * @file Live FinchNode client: sandbox Connect, records fetch, and mapping to `VerbatimFact`
 * (SPEC.md §4.1, §7.2, §11).
 *
 * Flow (FinchNode quickstart): `POST /connect/sessions` → `POST /connect/sessions/{id}/simulate`
 * with a synthetic scenario → poll until `simulation.state` is "completed" and `subject` is set →
 * `GET /users/{subject}/records`. Responses are validated with zod at the boundary. Records keep
 * FinchNode's own text, codes, dates, and source; nothing is reworded (SPEC.md §2).
 *
 * Fallbacks, in order, each labeled in `RecordsResult.origin`: the live sandbox subject → FinchNode's
 * public demo API (same normalized format, no key) → the saved snapshot in `fixtures/finchnode/`.
 * Observed 2026-10-04: sandbox simulations sync records but stay at `system-selected` without a
 * `subject`, so the demo API fallback is what currently answers.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import type { RecordCategory, VerbatimFact } from "@/lib/types";

/** Authenticated sandbox/production API. */
export const FINCHNODE_API_BASE = "https://api.finchnode.com/api/v1";
/** Public demo API: fixed synthetic patients, no key. */
export const FINCHNODE_DEMO_BASE = "https://api.finchnode.com/demo/v1";
/** Synthetic scenario to connect: the only one with records at both Northstar and Quillhaven. */
export const FINCHNODE_SCENARIO = process.env.FINCHNODE_SCENARIO || "multi-source-overlap";
/** Demo-API subject for each scenario we use. */
export const DEMO_SUBJECTS: Record<string, string> = {
  "multi-source-overlap": "patient-demo-multi-source",
  "baseline-adult": "patient-demo-001",
};
/** Categories requested at Connect and mapped into facts. */
export const CONNECT_CATEGORIES = ["labs", "medications", "conditions", "immunizations", "encounters"];
/** How long to wait for a simulated Connect session to finish. */
export const CONNECT_TIMEOUT_MS = 45_000;
/** Poll interval while waiting for a session. */
export const CONNECT_POLL_MS = 2_000;
/** Timeout for any single FinchNode request. */
const REQUEST_TIMEOUT_MS = 20_000;

/** Where records came from, shown to the user next to the evidence. */
export type RecordsOrigin = "live-sandbox" | "demo-api" | "saved-snapshot";

/**
 * Path of the saved demo-API response for the demo patient. A literal path, so Next.js traces only
 * this file into the server bundle.
 *
 * @returns Absolute path under the project root.
 */
export function savedSnapshotPath(): string {
  return join(process.cwd(), "fixtures", "finchnode", "multi-source-overlap.json");
}

/** Records plus provenance of the whole fetch. */
export interface RecordsResult {
  records: VerbatimFact[];
  /** Providers present in the records, first-seen order. */
  providers: string[];
  origin: RecordsOrigin;
  /** FinchNode subject the records belong to. */
  subject: string;
  /** Human-readable notes: fallbacks taken, records skipped for missing provenance. */
  warnings: string[];
}

/** Thrown when a FinchNode request fails or returns an unexpected shape. */
export class FinchNodeError extends Error {
  constructor(message: string, public readonly status?: number) {
    super(message);
    this.name = "FinchNodeError";
  }
}

/** One code on a record. */
const CodeSchema = z.object({ system: z.string().nullish(), code: z.string().nullish(), display: z.string().nullish() });

/** Fields shared by every normalized record; category-specific fields are read loosely. */
const RecordSchema = z
  .object({
    id: z.string().min(1),
    source: z.string().nullish(),
    sourceName: z.string().nullish(),
    codes: z.array(CodeSchema).default([]),
    name: z.string().nullish(),
    type: z.string().nullish(),
    date: z.string().nullish(),
    startDate: z.string().nullish(),
    recordedDate: z.string().nullish(),
    onsetDate: z.string().nullish(),
    status: z.string().nullish(),
  })
  .passthrough();

/** `GET /users/{subject}/records` snapshot. */
const SnapshotSchema = z.object({
  data: z.record(z.string(), z.unknown()),
  sources: z.array(z.object({ system: z.string(), organization: z.string() })).default([]),
});

/** Connect session, as far as this client reads it. */
const SessionSchema = z.object({
  id: z.string(),
  status: z.string(),
  subject: z.string().nullable(),
  simulation: z.object({ state: z.string() }).nullish(),
});

/** FinchNode category → our category. Others (vitals, encounters, allergies) are not facts we cite yet. */
const CATEGORY_MAP: Record<string, RecordCategory> = {
  labs: "lab",
  medications: "medication",
  conditions: "condition",
  immunizations: "immunization",
};

/** Coding-system URLs → short labels. Observation-category codes are not clinical codes and are skipped. */
const CODE_SYSTEMS: Array<[RegExp, string]> = [
  [/loinc\.org/, "LOINC"],
  [/rxnorm/, "RxNorm"],
  [/snomed/, "SNOMED CT"],
  [/cvx/, "CVX"],
  [/icd-10/i, "ICD-10"],
];

/**
 * Maps one normalized FinchNode record to a verbatim fact.
 *
 * Pure. Text, code, and date are copied as given (the date is cut to its YYYY-MM-DD part).
 *
 * @param category - FinchNode category key, e.g. "labs".
 * @param raw - One record from the snapshot.
 * @returns The fact, or an error string naming what provenance is missing.
 */
export function mapRecord(category: string, raw: unknown): VerbatimFact | string {
  const ours = CATEGORY_MAP[category];
  const parsed = RecordSchema.safeParse(raw);
  if (!ours) return `category ${category} is not used`;
  if (!parsed.success) return `${category} record has an unexpected shape`;
  const r = parsed.data;
  const text = r.name ?? r.type;
  const date = (r.date ?? r.startDate ?? r.recordedDate ?? r.onsetDate ?? "").slice(0, 10);
  if (!text || !r.sourceName || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return `${category} record ${r.id} is missing its text, provider, or date`;
  }
  let code: string | null = null;
  let codeSystem: string | null = null;
  for (const c of r.codes) {
    const label = CODE_SYSTEMS.find(([re]) => re.test(c.system ?? ""))?.[1];
    if (label && c.code) {
      code = c.code;
      codeSystem = label;
      break;
    }
  }
  return Object.freeze({ recordId: r.id, category: ours, text, code, codeSystem, recordedAt: date, provider: r.sourceName, status: r.status ?? null });
}

/**
 * Maps a whole records snapshot.
 *
 * @param snapshot - Parsed `GET /users/{subject}/records` body.
 * @returns Facts in category then record order, plus a warning per record skipped for missing provenance.
 * @throws {FinchNodeError} When the body is not a records snapshot.
 */
export function mapSnapshot(snapshot: unknown): { records: VerbatimFact[]; warnings: string[] } {
  const parsed = SnapshotSchema.safeParse(snapshot);
  if (!parsed.success) throw new FinchNodeError("FinchNode returned an unexpected records format.");
  const records: VerbatimFact[] = [];
  const warnings: string[] = [];
  for (const [category, list] of Object.entries(parsed.data.data)) {
    if (!CATEGORY_MAP[category] || !Array.isArray(list)) continue;
    for (const raw of list) {
      const out = mapRecord(category, raw);
      if (typeof out === "string") warnings.push(`Skipped: ${out}.`);
      else records.push(out);
    }
  }
  return { records, warnings };
}

/**
 * Sends one JSON request to FinchNode.
 *
 * @param url - Full URL.
 * @param init - Fetch options; the API key header is added when `key` is given.
 * @param key - Sandbox or live API key, or undefined for the demo API.
 * @returns The parsed JSON body.
 * @throws {FinchNodeError} On a non-2xx status, a network error, or a timeout.
 */
async function request(url: string, init: RequestInit = {}, key?: string): Promise<unknown> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (key) headers.Authorization = `Bearer ${key}`;
  let res: Response;
  try {
    res = await fetch(url, { ...init, headers, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  } catch (err) {
    throw new FinchNodeError(`Could not reach FinchNode (${err instanceof Error ? err.message : String(err)}).`);
  }
  if (!res.ok) throw new FinchNodeError(`FinchNode request failed (HTTP ${res.status}).`, res.status);
  return res.json();
}

/**
 * Connects a synthetic sandbox patient and waits for the subject.
 *
 * Side effects: creates a sandbox Connect session and runs a simulation in the team's FinchNode app.
 *
 * @param key - Sandbox API key (`ck_test_…`).
 * @param externalId - Our identifier for the session, e.g. a case ID.
 * @param timeoutMs - How long to wait for the simulation.
 * @returns The FinchNode subject.
 * @throws {FinchNodeError} When the session fails or no subject arrives in time.
 */
export async function connectSandboxPatient(key: string, externalId: string, timeoutMs = CONNECT_TIMEOUT_MS): Promise<string> {
  const created = SessionSchema.parse(
    await request(`${FINCHNODE_API_BASE}/connect/sessions`, { method: "POST", body: JSON.stringify({ externalId, categories: CONNECT_CATEGORIES }) }, key),
  );
  await request(`${FINCHNODE_API_BASE}/connect/sessions/${created.id}/simulate`, { method: "POST", body: JSON.stringify({ scenario: FINCHNODE_SCENARIO }) }, key);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, CONNECT_POLL_MS));
    const s = SessionSchema.parse(await request(`${FINCHNODE_API_BASE}/connect/sessions/${created.id}`, {}, key));
    if (s.simulation?.state === "failed") throw new FinchNodeError(`FinchNode sandbox session ${s.id} failed.`);
    if (s.subject) return s.subject;
  }
  throw new FinchNodeError(`FinchNode sandbox session ${created.id} did not finish within ${Math.round(timeoutMs / 1000)}s.`);
}

/**
 * Whether to attempt a new sandbox Connect. `FINCHNODE_CONNECT=off` skips it (straight to the demo
 * API) so a demo never waits on a stuck sandbox; a known subject (`FINCHNODE_SUBJECT`) is still used.
 *
 * @returns False when `FINCHNODE_CONNECT` is "off" or "false".
 */
export function connectEnabled(): boolean {
  const v = (process.env.FINCHNODE_CONNECT ?? "").toLowerCase();
  return v !== "off" && v !== "false";
}

/** After a failed sandbox Connect, skip reconnecting for this long so audits don't each wait the full timeout. */
export const CONNECT_RETRY_AFTER_MS = 10 * 60_000;

/** Per-process memory: the connected subject, or when the last Connect failed. */
const cache = globalThis as unknown as { __finchnodeSubject?: string; __finchnodeConnectFailedAt?: number };

/**
 * Loads the patient's records live, falling back to the demo API and then the saved snapshot.
 *
 * Side effects: network calls to FinchNode; may create a sandbox Connect session (once per process).
 *
 * @param opts - `key` (default `FINCHNODE_API_KEY`), `subject` (default `FINCHNODE_SUBJECT`), `externalId` for a new session.
 * @returns Records with origin and warnings. Never throws for network trouble; the saved snapshot is the last resort.
 */
export async function loadLiveRecords(opts: { key?: string; subject?: string; externalId?: string } = {}): Promise<RecordsResult> {
  const key = opts.key ?? process.env.FINCHNODE_API_KEY;
  const warnings: string[] = [];
  const finish = (snapshot: unknown, origin: RecordsOrigin, subject: string): RecordsResult => {
    const mapped = mapSnapshot(snapshot);
    const providers = [...new Set(mapped.records.map((r) => r.provider))];
    return { records: mapped.records, providers, origin, subject, warnings: [...warnings, ...mapped.warnings] };
  };

  const known = opts.subject ?? process.env.FINCHNODE_SUBJECT ?? cache.__finchnodeSubject;
  const recentlyFailed = Date.now() - (cache.__finchnodeConnectFailedAt ?? 0) < CONNECT_RETRY_AFTER_MS;
  if (key && (known || (!recentlyFailed && connectEnabled()))) {
    try {
      let subject = known;
      if (!subject) {
        try {
          subject = await connectSandboxPatient(key, opts.externalId ?? "mhacks-demo");
        } catch (err) {
          cache.__finchnodeConnectFailedAt = Date.now();
          throw err;
        }
      }
      cache.__finchnodeSubject = subject;
      return finish(await request(`${FINCHNODE_API_BASE}/users/${subject}/records`, {}, key), "live-sandbox", subject);
    } catch (err) {
      warnings.push(`Live sandbox unavailable: ${err instanceof Error ? err.message : String(err)} Using FinchNode's demo API.`);
    }
  } else if (key && !connectEnabled()) {
    warnings.push("Sandbox Connect is turned off (FINCHNODE_CONNECT=off); using FinchNode's demo API.");
  } else if (key) {
    warnings.push("Live sandbox Connect failed recently; using FinchNode's demo API.");
  } else {
    warnings.push("FINCHNODE_API_KEY is not set. Using FinchNode's demo API.");
  }

  const demoSubject = DEMO_SUBJECTS[FINCHNODE_SCENARIO] ?? DEMO_SUBJECTS["multi-source-overlap"];
  try {
    return finish(await request(`${FINCHNODE_DEMO_BASE}/users/${demoSubject}/records`), "demo-api", demoSubject);
  } catch (err) {
    warnings.push(`Demo API unavailable: ${err instanceof Error ? err.message : String(err)} Using the saved snapshot.`);
  }
  const saved = JSON.parse(readFileSync(savedSnapshotPath(), "utf8"));
  return finish(saved, "saved-snapshot", demoSubject);
}
