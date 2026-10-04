/**
 * @file Proves real FinchNode records map to verbatim facts with provenance, and that the live
 * loader falls back (sandbox → demo API → saved snapshot) with a labeled origin (SPEC.md §4.1, §7.2).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { findDocumentationGaps } from "@/lib/audit/rules";
import { loadRecords } from "@/lib/finchnode";
import { loadLiveRecords, mapRecord, mapSnapshot } from "@/lib/finchnode/live";
import { confirmedSampleBill } from "../helpers";

/** Saved response of FinchNode's demo API for the two-provider scenario. */
const snapshot = JSON.parse(readFileSync(join("fixtures", "finchnode", "multi-source-overlap.json"), "utf8"));

afterEach(() => {
  vi.unstubAllGlobals();
  delete (globalThis as { __finchnodeSubject?: string }).__finchnodeSubject;
  delete (globalThis as { __finchnodeConnectFailedAt?: number }).__finchnodeConnectFailedAt;
});

/**
 * Builds a fetch stub from a URL → response table.
 *
 * @param routes - Substring of the URL → JSON body, or an HTTP status to fail with.
 * @returns The stub, to inspect calls.
 */
function stubFetch(routes: Array<[string, unknown | number]>) {
  const fn = vi.fn(async (url: string) => {
    const hit = routes.find(([part]) => url.includes(part));
    if (!hit) throw new TypeError("fetch failed");
    const [, body] = hit;
    if (typeof body === "number") return new Response("{}", { status: body });
    return new Response(JSON.stringify(body), { status: 200 });
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

describe("mapSnapshot", () => {
  /** Proves records from both providers keep FinchNode's own text, code, date, and source. */
  it("maps labs, medications, conditions, and immunizations from both providers", () => {
    const { records, warnings } = mapSnapshot(snapshot);
    expect(warnings).toEqual([]);
    expect(records).toHaveLength(16);
    expect(new Set(records.map((r) => r.provider))).toEqual(
      new Set(["Northstar Health System (Synthetic)", "Quillhaven Medical Group (Synthetic)"]),
    );
    const tsh = records.find((r) => r.provider.startsWith("Quillhaven") && r.code === "3016-3");
    expect(tsh).toMatchObject({ category: "lab", codeSystem: "LOINC", recordedAt: "2026-03-05", text: "Thyrotropin [Units/volume] in Serum or Plasma" });
    expect(Object.isFrozen(tsh)).toBe(true);
  });
  /** Proves a record without provenance is skipped with a visible warning, never guessed. */
  it("skips records missing their provider or date", () => {
    expect(mapRecord("labs", { id: "rec_x", name: "Ferritin", codes: [] })).toMatch(/missing its text, provider, or date/);
    expect(mapRecord("vitals", { id: "rec_y" })).toMatch(/not used/);
  });
});

describe("loadLiveRecords", () => {
  /** Proves a known subject reads the sandbox records directly. */
  it("reads the live sandbox when a subject is known", async () => {
    const fetch = stubFetch([["/api/v1/users/sub_1/records", snapshot]]);
    const r = await loadLiveRecords({ key: "ck_test_x", subject: "sub_1" });
    expect(r.origin).toBe("live-sandbox");
    expect(r.providers).toHaveLength(2);
    expect(fetch.mock.calls[0][0]).toContain("/api/v1/users/sub_1/records");
  });
  /** Proves a failing sandbox falls back to the demo API with a warning, and isn't retried right away. */
  it("falls back to the demo API when the sandbox fails", async () => {
    stubFetch([
      ["/api/v1/connect/sessions", 500],
      ["/demo/v1/users/patient-demo-multi-source/records", snapshot],
    ]);
    const r = await loadLiveRecords({ key: "ck_test_x" });
    expect(r.origin).toBe("demo-api");
    expect(r.warnings[0]).toMatch(/Live sandbox unavailable/);
    const again = await loadLiveRecords({ key: "ck_test_x" });
    expect(again.warnings[0]).toMatch(/failed recently/);
  });
  /** Proves the saved snapshot is the last resort when FinchNode is unreachable. */
  it("uses the saved snapshot when FinchNode is unreachable", async () => {
    stubFetch([]);
    const r = await loadLiveRecords({ key: undefined });
    expect(r.origin).toBe("saved-snapshot");
    expect(r.records).toHaveLength(16);
  });
});

describe("FINCHNODE_CONNECT=off", () => {
  /** Proves the switch skips sandbox Connect entirely and goes straight to the demo API. */
  it("skips Connect and uses the demo API", async () => {
    process.env.FINCHNODE_CONNECT = "off";
    try {
      const fetch = stubFetch([["/demo/v1/users/patient-demo-multi-source/records", snapshot]]);
      const r = await loadLiveRecords({ key: "ck_test_x" });
      expect(r.origin).toBe("demo-api");
      expect(r.warnings[0]).toMatch(/turned off/);
      expect(fetch.mock.calls.every(([url]) => !String(url).includes("/connect/sessions"))).toBe(true);
    } finally {
      delete process.env.FINCHNODE_CONNECT;
    }
  });
});

describe("records for the right patient", () => {
  /** Proves the patient's name is read from FinchNode's demographics. */
  it("reads the patient name", () => {
    expect(mapSnapshot(snapshot).patientName).toBe("Priya Ramaswamy");
  });
  /** Proves another patient's case gets no records (and a plain warning), while the matching patient keeps them. */
  it("drops records for a different patient", async () => {
    process.env.USE_MOCK = "true";
    const same = await loadRecords("case_a", "Priya Ramaswamy");
    expect(same.records.length).toBeGreaterThan(0);
    const other = await loadRecords("case_b", "Marcus Bell");
    expect(other).toMatchObject({ records: [], providers: [] });
    expect(other.warnings.join(" ")).toMatch(/different patient/);
    expect(other.warnings.join(" ")).not.toMatch(/Priya/);
    expect((await loadRecords("case_c", null)).records.length).toBeGreaterThan(0);
  });
  /** Proves no documentation-gap findings are made when no records were searched. */
  it("makes no documentation gaps without records", async () => {
    const bill = await confirmedSampleBill();
    expect(findDocumentationGaps(bill, [], [])).toEqual([]);
  });
});
