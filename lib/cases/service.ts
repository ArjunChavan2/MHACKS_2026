/**
 * @file Case operations used by the API routes (MVP 1): ingest a document, confirm it, run the
 * audit, and draft letters. Keeps route handlers thin (SPEC.md §5.3).
 *
 * Every step appends a case event (SPEC.md §4.6).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runAudit } from "@/lib/audit";
import { draftDisputeLetter, draftItemizedBillRequest } from "@/lib/draft/letters";
import { billFields, eobFields, needsAttention } from "@/lib/extract/checks";
import { confirmBill, confirmEob, type ConfirmInput } from "@/lib/extract/confirm";
import { extractDocument, extractFromSavedReply, type ExtractionResult } from "@/lib/extract/pipeline";
import { getRecords, providersOf } from "@/lib/finchnode";
import type { AuditResult, ConfirmedBill, ConfirmedEob, Draft, ExtractedBill, ExtractedEob } from "@/lib/types";
import { getStore, newId, putFile } from "./store";

/** Names of the saved sample documents available for the labeled no-AI path. */
export const SAMPLE_NAMES = ["sample-bill", "sample-eob", "balance-statement", "bill-broken-totals", "bill-injection"] as const;

/** A sample document name. */
export type SampleName = (typeof SAMPLE_NAMES)[number];

/** What the client receives after a document is ingested. */
export interface IngestResponse {
  caseId: string;
  documentId: string;
  result: ExtractionResult;
  /** Field paths needing attention, in document order (flagged fields first on the confirm screen). */
  attention: string[];
}

/** Thrown for bad client input; routes map it to HTTP 400. */
export class BadRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BadRequestError";
  }
}

/**
 * Lists fields needing attention for an extraction result.
 *
 * @param result - Extraction result.
 * @returns Paths needing attention; empty for unsupported documents.
 */
function attentionOf(result: ExtractionResult): string[] {
  if (result.kind === "bill") return needsAttention(billFields(result.bill));
  if (result.kind === "eob") return needsAttention(eobFields(result.eob));
  return [];
}

/**
 * Stores an extraction as a document and logs the event.
 *
 * @param caseId - Existing case ID, or `null` to create one.
 * @param fileName - Original file name.
 * @param storageKey - Private storage key of the original file.
 * @param result - Extraction result.
 * @returns The ingest response.
 */
async function save(caseId: string | null, fileName: string, storageKey: string, result: ExtractionResult): Promise<IngestResponse> {
  const store = getStore();
  const cid = caseId ?? (await store.createCase(null));
  const documentId = newId("doc");
  const docType = result.kind === "bill" ? result.bill.docType : result.kind === "eob" ? "eob" : result.docType;
  await store.saveDocument({
    id: documentId,
    caseId: cid,
    docType,
    direction: "incoming",
    status: "received",
    fileName,
    storageKey,
    extraction: result.kind === "bill" ? result.bill : result.kind === "eob" ? result.eob : null,
    extractionMeta: result.meta,
    confirmed: null,
  });
  await store.addEvent(cid, "document_received", { documentId, docType, source: result.meta.source, fileName });
  return { caseId: cid, documentId, result, attention: attentionOf(result) };
}

/**
 * Ingests an uploaded file: stores it privately, extracts it with Gemini, and saves the result.
 *
 * @param caseId - Existing case ID or `null`.
 * @param fileName - Original file name.
 * @param mimeType - MIME type (PDF, JPEG, PNG, HEIC, WEBP).
 * @param bytes - File bytes.
 * @returns The ingest response.
 * @throws {BadRequestError} For unsupported file types.
 * @throws {import("@/lib/llm").LlmUnavailableError} When no Gemini key is set.
 */
export async function ingestUpload(caseId: string | null, fileName: string, mimeType: string, bytes: Uint8Array): Promise<IngestResponse> {
  const allowed = ["application/pdf", "image/jpeg", "image/png", "image/webp", "image/heic"];
  if (!allowed.includes(mimeType)) throw new BadRequestError(`Unsupported file type ${mimeType}. Upload a PDF or a photo.`);
  const key = putFile(bytes, mimeType);
  return save(caseId, fileName, key, await extractDocument({ mimeType, bytes }));
}

/**
 * Ingests a saved sample document through the labeled no-AI path (same checks as live).
 *
 * @param caseId - Existing case ID or `null`.
 * @param name - Sample name.
 * @returns The ingest response with `meta.source === "saved-fixture"`.
 * @throws {BadRequestError} For unknown sample names.
 */
export async function ingestSample(caseId: string | null, name: string): Promise<IngestResponse> {
  if (!(SAMPLE_NAMES as readonly string[]).includes(name)) throw new BadRequestError(`Unknown sample ${name}`);
  const dir = join(process.cwd(), "fixtures");
  const pdf = new Uint8Array(readFileSync(join(dir, "documents", `${name}.pdf`)));
  const raw = JSON.parse(readFileSync(join(dir, "llm-output", `${name}.json`), "utf8"));
  const key = putFile(pdf, "application/pdf");
  return save(caseId, `${name}.pdf (sample)`, key, await extractFromSavedReply(raw, pdf));
}

/**
 * Confirms a document's fields (SPEC.md §4.2 step 7).
 *
 * @param documentId - Document to confirm.
 * @param input - Corrections, explicit confirmations, totals acknowledgement.
 * @returns `{ ok: true }` when locked, or `{ ok: false, blocking }`.
 * @throws {BadRequestError} When the document is unknown, already confirmed, or not a bill/EOB.
 */
export async function confirmDocument(documentId: string, input: Omit<ConfirmInput, "documentId">): Promise<{ ok: true } | { ok: false; blocking: string[] }> {
  const store = getStore();
  const doc = await store.getDocument(documentId);
  if (!doc) throw new BadRequestError("Unknown document");
  if (doc.confirmed) throw new BadRequestError("This document is already confirmed and locked");
  if (!doc.extraction) throw new BadRequestError("This document type can't be confirmed");
  const full = { ...input, documentId };
  const r = doc.docType === "eob" ? confirmEob(doc.extraction as ExtractedEob, full) : confirmBill(doc.extraction as ExtractedBill, full);
  if (!r.ok) return r;
  await store.saveDocument({ ...doc, status: "confirmed", confirmed: r.value });
  await store.addEvent(doc.caseId, "fields_confirmed", {
    documentId,
    corrected: Object.keys(input.corrections),
    confirmedAsPrinted: input.confirmedPaths,
    totalsMismatchAcknowledged: input.acknowledgeTotalsMismatch,
  });
  return { ok: true };
}

/**
 * Loads a confirmed document of the expected kind.
 *
 * @param id - Document ID.
 * @param kind - "bill" or "eob".
 * @returns The confirmed value.
 * @throws {BadRequestError} When missing or not yet confirmed.
 */
async function loadConfirmed<K extends "bill" | "eob">(id: string, kind: K): Promise<K extends "bill" ? ConfirmedBill : ConfirmedEob> {
  const doc = await getStore().getDocument(id);
  if (!doc?.confirmed) throw new BadRequestError(`The ${kind === "bill" ? "bill" : "EOB"} must be confirmed before the audit runs`);
  if ((kind === "eob") !== (doc.docType === "eob")) throw new BadRequestError(`Document ${id} is not a ${kind}`);
  return doc.confirmed as K extends "bill" ? ConfirmedBill : ConfirmedEob;
}

/**
 * Runs the audit on confirmed documents against the patient's records.
 *
 * @param caseId - Case ID.
 * @param billId - Confirmed bill document ID.
 * @param eobId - Confirmed EOB document ID, or `null`.
 * @returns Findings, verdict, and the providers searched.
 * @throws {BadRequestError} When a document isn't confirmed.
 */
export async function auditCase(caseId: string, billId: string, eobId: string | null): Promise<AuditResult & { providers: string[] }> {
  const bill = await loadConfirmed(billId, "bill");
  const eob = eobId ? await loadConfirmed(eobId, "eob") : null;
  const records = getRecords();
  const providers = providersOf(records);
  const result = runAudit(bill, eob, records, providers);
  const store = getStore();
  await store.saveFindings(caseId, result.findings);
  await store.addEvent(caseId, "audit_run", { billId, eobId, findings: result.findings.map((f) => f.id), verdict: result.verdict });
  return { ...result, providers };
}

/**
 * Drafts the dispute letter from the stored audit inputs (re-runs the deterministic audit so the
 * letter is always built from server-side findings, never client-supplied text).
 *
 * @param caseId - Case ID.
 * @param billId - Confirmed bill document ID.
 * @param eobId - Confirmed EOB document ID, or `null`.
 * @returns The draft.
 * @throws {BadRequestError} When there are no findings to dispute.
 */
export async function draftLetter(caseId: string, billId: string, eobId: string | null): Promise<Draft> {
  const bill = await loadConfirmed(billId, "bill");
  const eob = eobId ? await loadConfirmed(eobId, "eob") : null;
  const records = getRecords();
  const { findings } = runAudit(bill, eob, records, providersOf(records));
  if (!findings.length) throw new BadRequestError("No potential issues were found, so there is nothing to dispute.");
  const draft = await draftDisputeLetter(bill, findings, process.env.GEMINI_API_KEY ? undefined : null);
  await getStore().addEvent(caseId, "letter_drafted", { kind: draft.kind, author: draft.author, findings: findings.map((f) => f.id) });
  return draft;
}

/**
 * Drafts an itemized-bill request from a balance statement's header.
 *
 * @param documentId - Balance statement document ID.
 * @returns The request draft.
 * @throws {BadRequestError} When the document is not a balance statement.
 */
export async function draftItemizedRequest(documentId: string): Promise<Draft> {
  const doc = await getStore().getDocument(documentId);
  if (!doc || doc.docType !== "balance_statement") throw new BadRequestError("An itemized-bill request needs a balance statement");
  const h = (doc.extraction as ExtractedBill).header;
  const draft = draftItemizedBillRequest({
    billingEntity: h.billingEntity.value ?? "the provider",
    patientName: h.patientName.value,
    accountNumber: h.accountNumber.value,
    serviceStart: h.serviceStart.value,
    serviceEnd: h.serviceEnd.value,
    amountDueCents: h.amountDue.value,
  });
  await getStore().addEvent(doc.caseId, "request_drafted", { kind: draft.kind, documentId });
  return draft;
}
