/**
 * @file Proves drafts can only state facts through placeholders filled by code, and that bad model
 * drafts fall back to the template (SPEC.md §4.5, §5.6).
 */
import { describe, expect, it } from "vitest";
import { runAudit } from "@/lib/audit";
import { DISCLAIMER, draftDisputeLetter, draftItemizedBillRequest } from "@/lib/draft/letters";
import { DraftRejectedError, fillContext, fillDraft, forbiddenFacts } from "@/lib/draft/placeholders";
import { getRecords, providersOf } from "@/lib/finchnode";
import { confirmedSampleBill, confirmedSampleEob, fakeClient } from "../helpers";

/**
 * Builds the demo bill and findings.
 *
 * @returns Confirmed bill and its findings.
 */
async function demo() {
  const bill = await confirmedSampleBill();
  const records = getRecords();
  const { findings } = runAudit(bill, await confirmedSampleEob(), records, providersOf(records));
  return { bill, findings };
}

describe("placeholder guard", () => {
  /** Proves the model can't write money, dates, or codes itself. */
  it("detects facts written outside placeholders", () => {
    expect(forbiddenFacts("You owe {{amount_due}}.")).toEqual([]);
    expect(forbiddenFacts("You were charged $142 twice.")).not.toEqual([]);
    expect(forbiddenFacts("On 09/14/2026 you visited.")).not.toEqual([]);
    expect(forbiddenFacts("Code 80053 was billed.")).not.toEqual([]);
  });
  /** Proves unknown placeholders and skipped findings are rejected. */
  it("rejects unknown placeholders and missing findings", async () => {
    const { bill, findings } = await demo();
    const ctx = fillContext(bill, findings);
    expect(() => fillDraft("Hi", ["{{balance_owed}}", "x"], ctx)).toThrow(DraftRejectedError);
    expect(() => fillDraft("Hi", [`{{finding:${findings[0].id}:letter}}`, "x"], ctx)).toThrow(/never mentioned/);
  });
});

describe("dispute letter", () => {
  /** Proves the template letter mentions every finding, carries sources, and ends with the disclaimer. */
  it("builds a cited template letter", async () => {
    const { bill, findings } = await demo();
    const d = await draftDisputeLetter(bill, findings, null);
    expect(d.author).toBe("template");
    const text = d.paragraphs.map((p) => p.text).join("\n");
    expect(text).toContain("QMG-305518");
    expect(text).toContain("$68.00");
    expect(text).toContain("my explanation of benefits");
    expect(text).not.toMatch(/\bAsk \w|your EOB/);
    expect(d.paragraphs.at(-1)?.text).toBe(DISCLAIMER);
    expect(d.paragraphs.some((p) => p.sources.length > 0)).toBe(true);
  });
  /** Proves a model draft that invents an amount is rejected and the template is used instead. */
  it("falls back to the template when the model invents a fact", async () => {
    const { bill, findings } = await demo();
    const bad = JSON.stringify({ subject: "Dispute", paragraphs: ["You charged me $500 too much.", "Fix it."] });
    const d = await draftDisputeLetter(bill, findings, fakeClient([bad]).client);
    expect(d.author).toBe("template");
  });
  /** Proves a well-formed model draft is accepted and filled by code. */
  it("accepts a valid model draft", async () => {
    const { bill, findings } = await demo();
    const good = JSON.stringify({
      subject: "Review of account {{account_number}}",
      paragraphs: ["I am writing about my bill.", ...findings.map((f) => `I would like this checked. {{finding:${f.id}:letter}}`), "Please reply in writing."],
    });
    const d = await draftDisputeLetter(bill, findings, fakeClient([good]).client);
    expect(d.author).toBe("llm");
    expect(d.subject).toBe("Review of account QMG-305518");
  });
  /** Proves finding text wrapped inside a sentence is retried, then replaced by the template. */
  it("rejects finding text buried mid-sentence", async () => {
    const { bill, findings } = await demo();
    const buried = JSON.stringify({
      subject: "Review",
      paragraphs: ["Dear {{provider}},", ...findings.map((f) => `Please check the issue described as {{finding:${f.id}:letter}} soon.`), "Thanks."],
    });
    const fake = fakeClient([buried, buried]);
    const d = await draftDisputeLetter(bill, findings, fake.client);
    expect(d.author).toBe("template");
    expect(fake.requests).toHaveLength(2);
  });
});

describe("itemized bill request", () => {
  /** Proves the request is drafted from header values alone and never lists charges. */
  it("drafts a request from a balance statement header", () => {
    const d = draftItemizedBillRequest({
      billingEntity: "Quillhaven Medical Group",
      patientName: "Priya Ramaswamy",
      accountNumber: "QMG-305518",
      serviceStart: null,
      serviceEnd: null,
      amountDueCents: 32100,
    });
    expect(d.kind).toBe("itemized_bill_request");
    expect(d.paragraphs.map((p) => p.text).join(" ")).toContain("fully itemized bill");
  });
});

describe("letter frame", () => {
  /** Proves code adds the greeting and sign-off around a model draft, so they are never missing. */
  it("wraps model drafts in a greeting and sign-off", async () => {
    const { bill, findings } = await demo();
    const good = JSON.stringify({ subject: "Review", paragraphs: ["I am writing about my bill.", ...findings.map((f) => `{{finding:${f.id}:letter}}`)] });
    const d = await draftDisputeLetter(bill, findings, fakeClient([good]).client);
    expect(d.paragraphs[0].text).toBe("To the billing office at Quillhaven Medical Group:");
    expect(d.paragraphs.at(-2)?.text).toBe("Thank you,\nPriya Ramaswamy");
  });
});
