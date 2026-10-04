/**
 * @file Proves the code checks on the model's document type (GitHub issue #5, weak spot 1): real
 * samples pass, while an EOB read as a bill, a random invoice read as a medical bill, and a
 * non-EOB read as an EOB are flagged and block confirmation until the patient confirms the type.
 */
import { describe, expect, it } from "vitest";
import { buildBill, buildEob } from "@/lib/extract/build";
import { confirmBill, confirmEob } from "@/lib/extract/confirm";
import { RawBillSchema, RawEobSchema, type RawField } from "@/lib/extract/schemas";
import { extractedBill, extractedEob, fixtureReply } from "../helpers";

const ABSENT: RawField = { raw: null, page: null, snippet: null, status: "absent" };
const base = { documentId: "doc_1", corrections: {}, confirmedPaths: [], acknowledgeTotalsMismatch: false };

/** The sample bill's raw reply. */
const billReply = () => RawBillSchema.parse(fixtureReply("sample-bill"));
/** The sample EOB's raw reply. */
const eobReply = () => RawEobSchema.parse(fixtureReply("sample-eob"));

describe("billTypeIssues", () => {
  /** Proves the real sample bills raise no doubt (no false alarms on the demo path). */
  it("accepts the sample bills", async () => {
    for (const name of ["sample-bill", "bill-broken-totals", "bill-injection", "balance-statement"] as const) {
      expect((await extractedBill(name)).typeIssues).toEqual([]);
    }
  });
  /** Proves an EOB misread as a bill is caught by its own "not a bill" wording. */
  it("flags a document that says it is not a bill", () => {
    const bill = buildBill(billReply(), ["Wolverine Mutual Health Explanation of Benefits. THIS IS NOT A BILL. Patient: Priya"]);
    expect(bill.typeIssues?.[0]).toMatch(/says it is "not a bill"/);
  });
  /** Proves a random invoice (no medical wording, codes, patient, or account) is flagged. */
  it("flags a non-medical invoice", () => {
    const raw = billReply();
    raw.header.patientName = ABSENT;
    raw.header.accountNumber = ABSENT;
    raw.lines = raw.lines.map((l) => ({ ...l, code: { ...l.code, raw: "SKU-WIDGET" }, codeType: ABSENT }));
    const bill = buildBill(raw, ["ACME Supply invoice. Widget x1 $245.00. Thank you for your order."]);
    expect(bill.typeIssues).toHaveLength(3);
    expect(bill.typeIssues?.join(" ")).toMatch(/medical-billing term.*patient name or account number.*medical billing code/);
  });
  /** Proves photos (no text layer) still get the structural checks. */
  it("checks photos structurally", () => {
    const raw = billReply();
    raw.header.patientName = ABSENT;
    raw.header.accountNumber = ABSENT;
    expect(buildBill(raw, null).typeIssues).toEqual(["No patient name or account number was found, which every medical bill prints."]);
  });
});

describe("eobTypeIssues", () => {
  /** Proves the sample EOB raises no doubt. */
  it("accepts the sample EOB", async () => {
    expect((await extractedEob()).typeIssues).toEqual([]);
  });
  /** Proves a document without EOB wording, insurer, or plan amounts is flagged. */
  it("flags a document that doesn't look like an EOB", () => {
    const raw = eobReply();
    raw.insurer = ABSENT;
    raw.lines = raw.lines.map((l) => ({ ...l, allowed: ABSENT, planPaid: ABSENT }));
    const eob = buildEob(raw, ["Quillhaven Medical Group statement. Amount due $253.00"]);
    expect(eob.typeIssues).toHaveLength(3);
  });
});

describe("confirmation gate", () => {
  /** Proves type doubts block confirmation until the patient confirms the type. */
  it("blocks until the patient confirms the type", () => {
    const bill = buildBill(billReply(), ["Explanation of Benefits. THIS IS NOT A BILL. Patient: Priya"]);
    const blocked = confirmBill(bill, base);
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.blocking[0]).toMatch(/not a bill/);
    // The text-layer cross-check also flags every field here; confirm those as printed to isolate the gate.
    const paths = Object.keys(bill.header).map((k) => `header.${k}`).concat(bill.lines.flatMap((l, i) => Object.keys(l).map((k) => `lines.${i}.${k}`)));
    expect(confirmBill(bill, { ...base, confirmedPaths: paths }).ok).toBe(false);
    expect(confirmBill(bill, { ...base, confirmedPaths: paths, acknowledgeDocType: true }).ok).toBe(true);
  });
  /** Proves the same gate on EOBs. */
  it("blocks a doubtful EOB until confirmed", () => {
    const raw = eobReply();
    raw.insurer = ABSENT;
    const eob = buildEob(raw, null);
    expect(confirmEob(eob, base).ok).toBe(false);
    expect(confirmEob(eob, { ...base, acknowledgeDocType: true }).ok).toBe(true);
  });
});
