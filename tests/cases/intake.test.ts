/**
 * @file Proves the case-level intake guards from GitHub issue #5: an EOB for another patient can't be audited, a
 * document from another case can't be audited, a doubtful balance statement needs the patient's
 * say-so before a request is drafted, and EOBs stored before the patient fields existed still work.
 * Memory store only: the guards are store-independent, and a fourth PGlite file starting in parallel
 * pushed the existing Postgres suites past their 10 s setup timeout.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { auditCase, confirmDocument, draftItemizedRequest, ingestSample, loadCase } from "@/lib/cases/service";
import { getStore, memoryStore, type CaseStore } from "@/lib/cases/store";
import type { ExtractedBill, ExtractedEob } from "@/lib/types";

const g = globalThis as typeof globalThis & { __mhStore?: CaseStore };
const AS_PRINTED = { corrections: {}, confirmedPaths: [], acknowledgeTotalsMismatch: false };
afterAll(() => {
  g.__mhStore = undefined;
});

/**
 * Changes a stored extraction, as if the document had printed something else.
 *
 * @param documentId - Stored document.
 * @param edit - Mutates the extraction.
 */
async function reprint<T extends ExtractedBill | ExtractedEob>(documentId: string, edit: (x: T) => void): Promise<void> {
  const doc = await getStore().getDocument(documentId);
  if (!doc) throw new Error("document missing");
  const extraction = structuredClone(doc.extraction) as T;
  edit(extraction);
  await getStore().saveDocument({ ...doc, extraction });
}

describe("intake guards", () => {
  beforeEach(() => {
    g.__mhStore = memoryStore();
  });

  /** Proves the EOB's patient name (now extracted) is checked: another patient's EOB can't be audited. */
  it("refuses to audit an EOB for another patient", async () => {
    const bill = await ingestSample(null, "sample-bill");
    const eob = await ingestSample(bill.caseId, "sample-eob");
    await confirmDocument(bill.documentId, AS_PRINTED);
    await confirmDocument(eob.documentId, { ...AS_PRINTED, corrections: { patientName: "Jordan Rivera" } });
    await expect(auditCase(bill.caseId, bill.documentId, eob.documentId)).rejects.toThrow(/Jordan Rivera, but the bill is for Priya Ramaswamy/);
  });

  /** Proves documents from two different cases can't be audited together. */
  it("refuses to audit a document from another case", async () => {
    const bill = await ingestSample(null, "sample-bill");
    const eob = await ingestSample(null, "sample-eob");
    await confirmDocument(bill.documentId, AS_PRINTED);
    await confirmDocument(eob.documentId, AS_PRINTED);
    await expect(auditCase(bill.caseId, bill.documentId, eob.documentId)).rejects.toThrow(/belong to this case/);
  });

  /** Proves a revised statement printing only the last digits of the account is accepted. */
  it("accepts a revised statement with a masked account number", async () => {
    const bill = await ingestSample(null, "sample-bill");
    await confirmDocument(bill.documentId, AS_PRINTED);
    const revised = await ingestSample(bill.caseId, "revised-statement");
    expect(await confirmDocument(revised.documentId, { ...AS_PRINTED, corrections: { "header.accountNumber": "XXXX5518" } })).toEqual({ ok: true });
  });

  /** Proves a balance statement whose type is in doubt needs the patient's say-so before a request is drafted. */
  it("gates the itemized-bill request on the type checks", async () => {
    const stmt = await ingestSample(null, "balance-statement");
    await reprint<ExtractedBill>(stmt.documentId, (x) => {
      x.typeIssues = ["No patient name or account number was found, which every balance statement prints."];
    });
    await expect(draftItemizedRequest(stmt.documentId)).rejects.toThrow(/Confirm this is a medical balance statement/);
    expect((await draftItemizedRequest(stmt.documentId, true)).kind).toBe("itemized_bill_request");
    const c = await getStore().getCase(stmt.caseId);
    expect(c?.events.find((e) => e.type === "request_drafted")?.data).toMatchObject({ docTypeAcknowledged: [expect.stringContaining("No patient name")] });
  });

  /** Proves an EOB stored before patient name and account existed still loads, confirms, and audits. */
  it("handles EOBs extracted before the new fields existed", async () => {
    const bill = await ingestSample(null, "sample-bill");
    const eob = await ingestSample(bill.caseId, "sample-eob");
    await reprint<ExtractedEob>(eob.documentId, (x) => {
      delete x.patientName;
      delete x.accountNumber;
    });
    expect((await loadCase(bill.caseId))?.documents).toHaveLength(2);
    await confirmDocument(bill.documentId, AS_PRINTED);
    expect(await confirmDocument(eob.documentId, AS_PRINTED)).toEqual({ ok: true });
    expect((await auditCase(bill.caseId, bill.documentId, eob.documentId)).findings.length).toBeGreaterThan(0);
  });
});
