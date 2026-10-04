/**
 * @file Proves appeal letters quote every criterion's records verbatim with sources, and that
 * missing criteria produce a documentation request instead of an appeal (SPEC.md §4.10).
 */
import { describe, expect, it } from "vitest";
import { evaluateDenial } from "@/lib/appeals/criteria";
import {
  draftAppealLetter,
  draftDocumentationRequest,
} from "@/lib/appeals/letter";
import {
  buildDenial,
  confirmDenial,
  type RawDenial,
} from "@/lib/extract/denial";
import { getRecords } from "@/lib/finchnode";
import { fixtureReply } from "../helpers";

/** The demo denial, confirmed as printed. */
function demoDenial() {
  const r = confirmDenial(
    buildDenial(fixtureReply("denial-letter") as RawDenial, null),
    {
      documentId: "doc_denial",
      corrections: {},
      confirmedPaths: [],
      acknowledgeTotalsMismatch: false,
    },
  );
  if (!r.ok) throw new Error(r.blocking.join("; "));
  return r.value;
}

describe("appeal letters", () => {
  /** Proves each criterion paragraph quotes the records from both providers and cites them. */
  it("quotes every record verbatim and attaches it as a source", () => {
    const denial = demoDenial();
    const records = getRecords();
    const d = draftAppealLetter(denial, evaluateDenial(denial, records));
    expect(d.kind).toBe("appeal_letter");
    expect(d.paragraphs[1].sources).toContainEqual(
      expect.objectContaining({
        kind: "document",
        documentId: denial.documentId,
        docType: "denial_letter",
      }),
    );
    const text = d.paragraphs.map((p) => p.text).join("\n");
    expect(text).toContain("PA-2026-0402-1183");
    expect(text).toContain("WMH-MP-112");
    expect(text).toContain(
      '"Hypothyroidism", recorded by Northstar Health System (Synthetic) on May 1, 2019',
    );
    expect(text).toContain(
      "recorded by Quillhaven Medical Group (Synthetic) on March 5, 2026",
    );
    const criteriaParas = d.paragraphs.filter((p) => /^\d\. /.test(p.text));
    expect(criteriaParas).toHaveLength(3);
    for (const p of criteriaParas) {
      expect(p.sources.length).toBeGreaterThan(0);
      for (const s of p.sources)
        if (s.kind === "record") expect(p.text).toContain(`"${s.fact.text}"`);
    }
  });
  /** Proves a missing criterion yields a documentation request and refuses to draft an appeal. */
  it("drafts a documentation request instead when a criterion is missing", () => {
    const denial = { ...demoDenial(), letterDate: "2026-09-01" };
    const e = evaluateDenial(denial, getRecords());
    expect(() => draftAppealLetter(denial, e)).toThrow(
      /only when every criterion is met/,
    );
    const req = draftDocumentationRequest(denial, e);
    expect(req.kind).toBe("documentation_request");
    expect(req.paragraphs.map((p) => p.text).join(" ")).toContain(
      "thyroid function test",
    );
  });
});
