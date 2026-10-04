/** @file Review progress regression checks: missing required charges stay unresolved and edits never claim server confirmation. */
import { describe, expect, it } from "vitest";
import { reviewItems } from "@/lib/extract/reviewProgress";
import type { Field } from "@/lib/types";

/** Synthetic field factory for administrative UI progress; no clinical or patient data. */
function field(
  raw: string | null,
  verification: "verified" | "needs_attention" = "needs_attention",
): Field<string> {
  return {
    raw,
    value: raw,
    status: raw === null ? "absent" : "read",
    verification,
    page: 1,
    snippet: null,
    issues: verification === "needs_attention" ? ["Check this value"] : [],
  };
}

describe("document review progress", () => {
  /** A blank required charge cannot be waived, even by the printed-value checkbox. */
  it("keeps a missing charge unfinished until a usable amount is entered", () => {
    const fields: Array<[string, Field<unknown>]> = [
      ["lines.0.charge", field(null)],
    ];
    expect(reviewItems(fields, {}, ["lines.0.charge"], [])[0]).toMatchObject({
      missing: true,
      reviewed: false,
    });
    expect(
      reviewItems(fields, { "lines.0.charge": "not money" }, [], [])[0]
        .reviewed,
    ).toBe(false);
    expect(
      reviewItems(fields, { "lines.0.charge": "$12.00" }, [], [])[0],
    ).toMatchObject({ missing: false, reviewed: true });
  });
  /** Explicit confirmation and changed values are review actions, while initial flagged values are pending. */
  it("tracks confirmed or edited flagged values and surfaces new missing charges", () => {
    const fields: Array<[string, Field<unknown>]> = [
      ["header.accountNumber", field("demo")],
      ["lines.0.charge", field("$12.00", "verified")],
    ];
    expect(reviewItems(fields, {}, [], [])[0].reviewed).toBe(false);
    expect(
      reviewItems(fields, {}, ["header.accountNumber"], [])[0].reviewed,
    ).toBe(true);
    expect(
      reviewItems(fields, { "header.accountNumber": "corrected" }, [], [])[0]
        .reviewed,
    ).toBe(true);
    expect(
      reviewItems(fields, { "lines.0.charge": "" }, [], []).at(-1),
    ).toMatchObject({ path: "lines.0.charge", missing: true, reviewed: false });
  });
  /** Server-returned field failures remain unfinished even after an earlier edit or confirmation. */
  it("keeps server-rejected fields highlighted", () => {
    const fields: Array<[string, Field<unknown>]> = [
      ["header.accountNumber", field("demo")],
    ];
    expect(
      reviewItems(
        fields,
        { "header.accountNumber": "changed" },
        ["header.accountNumber"],
        ["Check this value"],
      )[0],
    ).toMatchObject({ reviewed: false, errors: ["Check this value"] });
  });
});
