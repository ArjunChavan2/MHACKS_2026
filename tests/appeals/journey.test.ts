/** @file Denial journey persistence, confirmation prerequisite, unknown policy handoff and missing-record doctor request. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  appealDenial,
  editLetter,
  confirmDocument,
  ingestSample,
  loadCase,
} from "@/lib/cases/service";
import { memoryStore, type CaseStore } from "@/lib/cases/store";

/** Per-test isolated case persistence. */
const g = globalThis as typeof globalThis & { __mhStore?: CaseStore };
/** Patient confirmation of a checked synthetic notice. */
const CONFIRM = {
  corrections: {},
  confirmedPaths: [],
  acknowledgeTotalsMismatch: false,
};
beforeEach(() => {
  g.__mhStore = memoryStore();
  vi.stubEnv("USE_MOCK", "true");
});
afterEach(() => vi.unstubAllEnvs());
describe("denial patient journey", () => {
  /** Reload returns the identical deterministic evaluation, draft and original record provenance. */
  it("requires confirmation and persists appeal evidence for reload", async () => {
    const denial = await ingestSample(null, "denial-letter");
    await expect(appealDenial(denial.documentId)).rejects.toThrow(/Confirm/);
    expect((await confirmDocument(denial.documentId, CONFIRM)).ok).toBe(true);
    const result = await appealDenial(denial.documentId);
    expect(result.draft.kind).toBe("appeal_letter");
    const saved = (await loadCase(denial.caseId))!;
    expect(saved.state.next.title).toBe("Review your denial correspondence");
    expect(saved.state.allowed).toEqual([]);
    expect((await loadCase(denial.caseId))?.appeal).toEqual({
      ...result,
      documentId: denial.documentId,
    });
    expect(
      result.evaluation.criteria.every((c) =>
        c.evidence.every((e) => e.recordId && e.provider),
      ),
    ).toBe(true);
  });
  /** Edited denial correspondence reloads in the appeal flow without replacing policy evidence. */
  it("restores personalized appeal wording after reload and reset", async () => {
    const denial = await ingestSample(null, "denial-letter");
    await confirmDocument(denial.documentId, CONFIRM);
    const original = await appealDenial(denial.documentId);
    const updated = await editLetter(denial.caseId, { expectedText: original.draft.paragraphs.map((p) => p.text), edits: [], personalNote: "Please send me a written explanation.", reset: false });
    const reloaded = (await loadCase(denial.caseId))!;
    expect(reloaded.appeal!.draft).toEqual(updated.draft);
    expect(reloaded.appeal!.evaluation).toEqual(original.evaluation);
    expect(reloaded.appeal!.draft.personalNote).toBe("Please send me a written explanation.");
    const reset = await editLetter(denial.caseId, { expectedText: updated.draft!.paragraphs.map((p) => p.text), edits: [], personalNote: "", reset: true });
    expect(reset.appeal!.draft.paragraphs).toEqual(original.draft.paragraphs);
  });

  /** Missing time-window documentation routes to the doctor rather than an unsupported appeal. */
  it("prepares a doctor request when a criterion is missing", async () => {
    const denial = await ingestSample(null, "denial-letter");
    expect(
      (
        await confirmDocument(denial.documentId, {
          ...CONFIRM,
          corrections: {
            "fields.letterDate": "2026-09-01",
            "fields.appealDeadline": "2026-11-01",
          },
        })
      ).ok,
    ).toBe(true);
    const result = await appealDenial(denial.documentId);
    expect(
      (await loadCase(denial.caseId))?.documents[0].confirmedValues?.[
        "fields.letterDate"
      ],
    ).toBe("2026-09-01");
    expect(result.evaluation.allMet).toBe(false);
    expect(result.draft.kind).toBe("documentation_request");
    expect((await loadCase(denial.caseId))?.appeal?.draft.kind).toBe(
      "documentation_request",
    );
  });
  /** An unsupported policy leaves the confirmed notice intact and drafts nothing. */
  it("hands unknown policies to a human without inventing criteria", async () => {
    const denial = await ingestSample(null, "denial-letter");
    await confirmDocument(denial.documentId, {
      ...CONFIRM,
      corrections: { "fields.policyId": "UNKNOWN-POLICY" },
    });
    await expect(appealDenial(denial.documentId)).rejects.toThrow(
      /human advocate/,
    );
    expect((await loadCase(denial.caseId))?.appeal).toBeNull();
    expect((await loadCase(denial.caseId))?.draft).toBeNull();
  });
});
