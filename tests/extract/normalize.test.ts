/**
 * @file Proves printed values normalize correctly and unparseable values are never guessed
 * (SPEC.md §4.2 step 2).
 */
import { describe, expect, it } from "vitest";
import { parseCodeType, parseDate, parseInteger, parseMoney, toField } from "@/lib/extract/normalize";

describe("parseMoney", () => {
  /** Proves common printed money formats become integer cents, credits negative. */
  it("parses dollars, commas, negatives, parentheses, and CR", () => {
    expect(parseMoney("$1,724.00")).toBe(172400);
    expect(parseMoney("-$524.00")).toBe(-52400);
    expect(parseMoney("($524.00)")).toBe(-52400);
    expect(parseMoney("524.00 CR")).toBe(-52400);
    expect(parseMoney("18")).toBe(1800);
    expect(parseMoney("$0.5")).toBe(50);
  });
  /** Proves junk and over-precise amounts stay null instead of being guessed. */
  it("rejects junk and more than two decimals", () => {
    expect(parseMoney("$12.345")).toBeNull();
    expect(parseMoney("about $40")).toBeNull();
    expect(parseMoney("")).toBeNull();
  });
});

describe("parseDate", () => {
  /** Proves US and ISO dates normalize to ISO. */
  it("parses MM/DD/YYYY and YYYY-MM-DD", () => {
    expect(parseDate("09/14/2026")).toBe("2026-09-14");
    expect(parseDate("9-4-2026")).toBe("2026-09-04");
    expect(parseDate("2026-09-14")).toBe("2026-09-14");
  });
  /** Proves impossible or ambiguous dates are rejected. */
  it("rejects impossible dates", () => {
    expect(parseDate("02/30/2026")).toBeNull();
    expect(parseDate("Sept 14")).toBeNull();
  });
});

describe("other parsers and toField", () => {
  /** Proves integers and code types parse strictly. */
  it("parses integers and code types", () => {
    expect(parseInteger("3")).toBe(3);
    expect(parseInteger("1.5")).toBeNull();
    expect(parseCodeType("hcpcs")).toBe("HCPCS");
    expect(parseCodeType("ICD")).toBeNull();
  });
  /** Proves an unreadable field is flagged "[to confirm]" and keeps a null value. */
  it("flags unreadable and unparseable fields", () => {
    const unreadable = toField({ raw: null, page: 1, snippet: null, status: "unreadable" }, parseMoney, "Line 2 charge");
    expect(unreadable.value).toBeNull();
    expect(unreadable.verification).toBe("needs_attention");
    expect(unreadable.issues[0]).toContain("[to confirm]");
    const bad = toField({ raw: "$1O.00", page: 1, snippet: null, status: "read" }, parseMoney, "Line 2 charge");
    expect(bad.value).toBeNull();
    expect(bad.verification).toBe("needs_attention");
  });
});

describe("labels", () => {
  /** Proves printed headings map to provider types and code types are inferred from format only. */
  it("normalizes provider-type headings and infers code types", async () => {
    const { parseProviderType, inferCodeType } = await import("@/lib/extract/normalize");
    expect(parseProviderType("Facility charges")).toBe("facility");
    expect(parseProviderType("Professional fees")).toBe("clinician");
    expect(parseProviderType("Pharmacy")).toBeNull();
    expect(inferCodeType("80053")).toBe("CPT");
    expect(inferCodeType("J1885")).toBe("HCPCS");
    expect(inferCodeType("0450")).toBeNull();
  });
});
