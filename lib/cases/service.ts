/**
 * @file Case operations used by the API routes (MVP 1): ingest a document, confirm it, run the
 * audit, draft letters, and load a saved case. Keeps route handlers thin (SPEC.md §5.3).
 *
 * Every step appends a case event (SPEC.md §4.6). Drafted letters are saved as outgoing documents.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { computeVerdict, runAudit } from "@/lib/audit";
import {
  draftDisputeLetter,
  draftInsurerLetter,
  draftItemizedBillRequest,
} from "@/lib/draft/letters";
import { billFields, eobFields, needsAttention } from "@/lib/extract/checks";
import {
  confirmBill,
  confirmEob,
  rawOf,
  type ConfirmInput,
} from "@/lib/extract/confirm";
import { buildBill, buildEob } from "@/lib/extract/build";
import type { RawBill, RawEob } from "@/lib/extract/schemas";
import type { Field } from "@/lib/types";
import { confirmDenial, denialFields, DENIAL_KEYS } from "@/lib/extract/denial";
import { evaluateDenial, type DenialEvaluation } from "@/lib/appeals/criteria";
import {
  draftAppealLetter,
  draftDocumentationRequest,
} from "@/lib/appeals/letter";
import {
  extractDocument,
  extractFromSavedReply,
  type ExtractionResult,
} from "@/lib/extract/pipeline";
import { prepareUpload } from "@/lib/extract/upload";
import { loadRecords, type RecordsOrigin } from "@/lib/finchnode";
import { llmConfigured } from "@/lib/llm";
import {
  caseStateOf,
  verifyRevisedStatement,
  type CaseState,
} from "./caseflow";
import { validateCaseDocument, resumeCaseDocument } from "./attachments";
import { billEobMismatches, revisedMismatches } from "./consistency";
import { mergeFindings, CaseRuleError } from "./responses";
import type {
  AuditResult,
  ConfirmedBill,
  ConfirmedDenial,
  ConfirmedEob,
  Draft,
  ExtractedBill,
  ExtractedDenial,
  ExtractedEob,
  Finding,
  Verdict,
} from "@/lib/types";
import { getStore, newId, type StoredDocument } from "./store";

/** Names of the saved sample documents available for the labeled no-AI path. */
export const SAMPLE_NAMES = [
  "sample-bill",
  "sample-eob",
  "balance-statement",
  "bill-broken-totals",
  "bill-injection",
  "revised-statement",
  "denial-letter",
] as const;

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

/** Audit result plus the providers whose records were searched and where those records came from. */
export type AuditResponse = AuditResult & {
  providers: string[];
  /** Origin of the records (live sandbox, FinchNode demo API, saved snapshot, or the sample fixture). */
  recordsOrigin?: RecordsOrigin;
  /** Fallbacks taken or records skipped while loading records. */
  recordWarnings?: string[];
};

/** A saved case as the app reloads it (SPEC.md §4.6 timeline). */
export interface CaseView {
  caseId: string;
  status: string;
  /** Incoming bills and EOBs in upload order, with whether each is confirmed and locked. */
  documents: Array<{
    ingest: IngestResponse;
    confirmed: boolean;
    /** Stored filename, including sample labels. */
    fileName?: string | null;
    /** Patient-selected paperwork task, retained across reload for pending confirmation. */
    taskId?: string;
    /** Patient-confirmed denial values for locked display after reload. Original PDF stays unchanged. */
    confirmedValues?: Record<string, string | null>;
  }>;
  /** The latest audit, or `null` if none has run. */
  audit: AuditResponse | null;
  /** The latest drafted letter or request, or `null`. */
  draft: Draft | null;
  /** Latest saved denial evaluation; verbatim evidence survives reload. */
  appeal: (AppealResponse & { documentId: string }) | null;
  /** Adaptive case state (MVP 2): phase, next action, allowed actions, tasks, savings, timeline. */
  state: CaseState;
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
  if (result.kind === "denial")
    return needsAttention(denialFields(result.denial));
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
async function save(
  caseId: string | null,
  fileName: string,
  storageKey: string,
  result: ExtractionResult,
): Promise<IngestResponse> {
  const store = getStore();
  if (caseId && !(await store.getCase(caseId)))
    throw new BadRequestError("Unknown case");
  const cid = caseId ?? (await store.createCase(null));
  const documentId = newId("doc");
  const docType =
    result.kind === "bill"
      ? result.bill.docType
      : result.kind === "eob"
        ? "eob"
        : result.kind === "denial"
          ? "denial_letter"
          : result.docType;
  await store.saveDocument({
    id: documentId,
    caseId: cid,
    docType,
    direction: "incoming",
    status: "received",
    fileName,
    storageKey,
    extraction:
      result.kind === "bill"
        ? result.bill
        : result.kind === "eob"
          ? result.eob
          : result.kind === "denial"
            ? result.denial
            : null,
    extractionMeta: result.meta,
    confirmed: null,
    draft: null,
  });
  await store.addEvent(cid, "document_received", {
    documentId,
    docType,
    source: result.meta.source,
    fileName,
  });
  return { caseId: cid, documentId, result, attention: attentionOf(result) };
}

/**
 * Ingests an uploaded file: checks it, stores it privately, extracts it with the AI provider, and
 * saves the result.
 *
 * The type is detected from the bytes (the browser's label is ignored), PDFs over the page limit are
 * refused, and HEIC photos are stored and extracted as JPEG (`prepareUpload`). Nothing is stored or
 * sent to a model for a refused file.
 *
 * @param caseId - Existing case ID or `null`.
 * @param fileName - Original file name.
 * @param bytes - File bytes.
 * @returns The ingest response; identical bytes already on a known case reuse its document.
 * Sequential retries are idempotent within an existing case; first uploads without a case ID are not.
 * @throws {import("@/lib/extract/upload").UploadRejectedError} For an unrecognized, unreadable, or oversized file.
 * @throws {BadRequestError} For an unknown case.
 * @throws {import("@/lib/llm").LlmUnavailableError} When the active AI provider's key is not set.
 */
export async function ingestUpload(caseId: string | null, fileName: string, bytes: Uint8Array): Promise<IngestResponse> {
  const file = await prepareUpload(bytes);
  if (caseId) {
    const existing = await getStore().getCase(caseId);
    if (!existing) throw new BadRequestError("Unknown case");
    const digest = createHash("sha256").update(file.bytes).digest("hex");
    for (const doc of existing.documents) {
      if (doc.direction !== "incoming" || !doc.storageKey) continue;
      const stored = await getStore().getFile(doc.storageKey);
      if (stored?.mimeType === file.mimeType && createHash("sha256").update(stored.bytes).digest("hex") === digest) {
        const prior = ingestOf(doc);
        if (prior) return prior;
      }
    }
  }
  const result = await extractDocument({ mimeType: file.mimeType, bytes: file.bytes });
  const key = await getStore().putFile(file.bytes, file.mimeType);
  return save(caseId, fileName, key, result);
}

/**
 * Ingests a saved sample document through the labeled no-AI path (same checks as live).
 *
 * @param caseId - Existing case ID or `null`.
 * @param name - Sample name.
 * @returns The ingest response with `meta.source === "saved-fixture"`.
 * @throws {BadRequestError} For unknown sample names.
 */
export async function ingestSample(
  caseId: string | null,
  name: string,
): Promise<IngestResponse> {
  if (!(SAMPLE_NAMES as readonly string[]).includes(name))
    throw new BadRequestError(`Unknown sample ${name}`);
  const dir = join(process.cwd(), "fixtures");
  const pdf = new Uint8Array(
    readFileSync(join(dir, "documents", `${name}.pdf`)),
  );
  const raw = JSON.parse(
    readFileSync(join(dir, "llm-output", `${name}.json`), "utf8"),
  );
  const key = await getStore().putFile(pdf, "application/pdf");
  return save(
    caseId,
    `${name}.pdf (sample)`,
    key,
    await extractFromSavedReply(raw, pdf),
  );
}

/**
 * Confirms a document's fields (SPEC.md §4.2 step 7). A revised statement for a different account
 * than the original bill is refused (GitHub issue #5), and any doubts the type checks raised must
 * have been acknowledged.
 *
 * @param documentId - Document to confirm.
 * @param input - Corrections, explicit confirmations, totals and document-type acknowledgements.
 * @returns `{ ok: true }` when locked, or `{ ok: false, blocking }`.
 * @throws {BadRequestError} When the document is unknown, already confirmed, or not a bill/EOB.
 */
export async function confirmDocument(
  documentId: string,
  input: Omit<ConfirmInput, "documentId">,
): Promise<{ ok: true } | { ok: false; blocking: string[] }> {
  const store = getStore();
  const doc = await store.getDocument(documentId);
  if (!doc) throw new BadRequestError("Unknown document");
  if (doc.confirmed)
    throw new BadRequestError("This document is already confirmed and locked");
  if (!doc.extraction)
    throw new BadRequestError("This document type can't be confirmed");
  const full = { ...input, documentId };
  const r =
    doc.docType === "eob"
      ? confirmEob(doc.extraction as ExtractedEob, full)
      : doc.docType === "denial_letter"
        ? confirmDenial(doc.extraction as ExtractedDenial, full)
        : confirmBill(doc.extraction as ExtractedBill, full);
  if (!r.ok) return r;
  // A revised statement can only verify savings for the same account as the original bill.
  if (doc.docType === "revised_statement") {
    const c = await store.getCase(doc.caseId);
    const original = c?.documents.find(
      (d) =>
        d.direction === "incoming" &&
        d.docType === "itemized_bill" &&
        d.confirmed,
    );
    const mismatch = original
      ? revisedMismatches(
          original.confirmed as ConfirmedBill,
          r.value as ConfirmedBill,
        )
      : [];
    if (mismatch.length)
      return {
        ok: false,
        blocking: [
          ...mismatch,
          "This doesn't look like a revised statement for the same bill, so it can't be used to verify savings.",
        ],
      };
  }
  // Confirmation only got here with any type doubts acknowledged; record which ones.
  const typeIssues = (doc.extraction as ExtractedBill | ExtractedEob).typeIssues ?? [];
  const c = await store.getCase(doc.caseId);
  if (!c) throw new BadRequestError("Unknown case");
  const attached = c.events.some(
    (e) =>
      e.type === "case_document_attached" &&
      (e.data as { documentId: string }).documentId === documentId,
  );
  if (attached || doc.docType === "revised_statement") {
    try {
      validateCaseDocument(c, { ...doc, confirmed: r.value });
    } catch (err) {
      if (!(err instanceof CaseRuleError)) throw err;
      return { ok: false, blocking: [err.message] };
    }
  }
  await store.saveDocument({
    ...doc,
    extraction: correctedExtraction(doc, input.corrections),
    status: "confirmed",
    confirmed: r.value,
  });
  await store.addEvent(doc.caseId, "fields_confirmed", {
    documentId,
    corrected: Object.keys(input.corrections),
    confirmedAsPrinted: input.confirmedPaths,
    totalsMismatchAcknowledged: input.acknowledgeTotalsMismatch,
    ...(typeIssues.length ? { docTypeAcknowledged: typeIssues } : {}),
  });
  // A confirmed revised statement is checked against the original bill (MVP 2 verification).
  if (doc.docType === "revised_statement")
    await verifyRevisedStatement(doc.caseId, documentId);
  if (attached) await resumeCaseDocument(doc.caseId, documentId);
  return { ok: true };
}

/** Rebuilds patient-corrected raw fields for later editing; original files and source snippets remain intact.
 * @param doc - Stored bill or EOB.
 * @param corrections - Patient-entered raw values validated by the confirmation routine.
 * @returns The current extraction, with corrected values normalized through the existing builders.
 */
function correctedExtraction(
  doc: StoredDocument,
  corrections: ConfirmInput["corrections"],
): unknown {
  if (!Object.keys(corrections).length) return doc.extraction;
  if (doc.docType === "eob") {
    const e = doc.extraction as ExtractedEob;
    return buildEob(
      {
        docType: "eob",
        insurer: rawOf(e.insurer, "insurer", corrections),
        claimNumber: rawOf(e.claimNumber, "claimNumber", corrections),
        provider: rawOf(e.provider, "provider", corrections),
        // Absent on EOBs extracted before these fields existed.
        patientName: e.patientName ? rawOf(e.patientName, "patientName", corrections) : { raw: null, page: null, snippet: null, status: "absent" },
        accountNumber: e.accountNumber ? rawOf(e.accountNumber, "accountNumber", corrections) : { raw: null, page: null, snippet: null, status: "absent" },
        totalPatientResponsibility: rawOf(
          e.totalPatientResponsibility,
          "totalPatientResponsibility",
          corrections,
        ),
        lines: e.lines.map((line, i) =>
          Object.fromEntries(
            Object.entries(line).map(([key, field]) => [
              key,
              rawOf(field as Field<unknown>, `lines.${i}.${key}`, corrections),
            ]),
          ),
        ) as RawEob["lines"],
      },
      null,
    );
  }
  if (doc.docType !== "itemized_bill") return doc.extraction;
  const b = doc.extraction as ExtractedBill;
  return buildBill(
    {
      docType: b.docType,
      header: Object.fromEntries(
        Object.entries(b.header).map(([key, field]) => [
          key,
          rawOf(field, `header.${key}`, corrections),
        ]),
      ) as RawBill["header"],
      lines: b.lines.map((line, i) =>
        Object.fromEntries(
          Object.entries(line).map(([key, field]) => [
            key,
            rawOf(field as Field<unknown>, `lines.${i}.${key}`, corrections),
          ]),
        ),
      ) as RawBill["lines"],
    },
    null,
  );
}

/**
 * Saves the patient's choice to exclude or restore a finding, retaining its evidence unchanged.
 * Supersedes unsent drafts so a prior letter cannot carry an excluded issue forward.
 * @param caseId - Existing audited case.
 * @param findingId - Server-produced finding identifier.
 * @param excluded - Whether the patient does not want to pursue the issue.
 * @returns Refreshed case with the persisted choice and recomputed review amount.
 */
export async function setFindingExcluded(
  caseId: string,
  findingId: string,
  excluded: boolean,
): Promise<CaseView> {
  const store = getStore();
  const c = await store.getCase(caseId);
  if (!c) throw new BadRequestError("Unknown case");
  if (
    c.events.some((e) =>
      [
        "approval_recorded",
        "dispute_sent",
        "response_recorded",
        "consent_given",
        "call_recorded",
        "document_requested",
        "follow_up_sent",
      ].includes(e.type),
    )
  )
    throw new BadRequestError(
      "This case already has recorded approvals or correspondence. Contact support to change the issues being pursued.",
    );
  if (!c.findings.some((f) => f.id === findingId))
    throw new BadRequestError("Unknown finding for this case");
  for (const d of c.documents.filter(
    (d) => d.direction === "outgoing" && d.draft && d.status !== "superseded",
  ))
    await store.saveDocument({ ...d, status: "superseded" });
  await store.saveFindings(
    caseId,
    c.findings.map((f) =>
      f.id === findingId ? { ...f, patientExcluded: excluded } : f,
    ),
  );
  await store.addEvent(caseId, "finding_selection_changed", {
    findingId,
    excluded,
  });
  await store.setCaseStatus(caseId, "audited");
  return (await loadCase(caseId))!;
}

/**
 * Personalizes the latest unsent letter using server-held originals. Sourced facts and the final
 * disclaimer are immutable. Each save replaces the draft document, requiring fresh approval.
 * @param caseId - Case owning the letter.
 * @param input - Expected current text, edits to source-free paragraphs, a personal note, or reset.
 * @returns Refreshed case containing the saved letter.
 */
export async function editLetter(caseId: string, input: { expectedText: string[]; edits: { index: number; text: string }[]; personalNote: string; reset: boolean }): Promise<CaseView> {
  const store = getStore();
  const c = await store.getCase(caseId);
  if (!c) throw new BadRequestError("Unknown case");
  if (c.events.some((e) => ["approval_recorded", "dispute_sent", "response_recorded", "consent_given", "call_recorded", "document_requested", "follow_up_sent"].includes(e.type)))
    throw new BadRequestError("This case already has recorded approvals or correspondence. Its letter cannot be edited here.");
  const document = c.documents.filter((d) => d.direction === "outgoing" && d.status !== "superseded" && d.draft).at(-1);
  if (!document) throw new BadRequestError("No current letter to edit");
  const current = document.draft as Draft;
  if (JSON.stringify(current.paragraphs.map((p) => p.text)) !== JSON.stringify(input.expectedText))
    throw new BadRequestError("This letter changed. Reload the case before editing it.");
  const original = current.originalParagraphs ?? current.paragraphs;
  const paragraphs = original.map((p) => ({ ...p }));
  if (!input.reset) {
    for (const edit of input.edits) {
      const paragraph = original[edit.index];
      if (!paragraph || paragraph.sources.length || edit.index === original.length - 1)
        throw new BadRequestError("Document facts and the disclaimer cannot be edited. Correct the bill or EOB details instead.");
      paragraphs[edit.index] = { ...paragraph, text: edit.text.trim(), patientProvided: edit.text.trim() !== paragraph.text };
    }
    if (input.personalNote.trim()) paragraphs.splice(paragraphs.length - 1, 0, { text: input.personalNote.trim(), sources: [], patientProvided: true });
  }
  const draft: Draft = { ...current, paragraphs, originalParagraphs: original, personalNote: input.reset ? "" : input.personalNote.trim(), patientEdited: !input.reset };
  const documentId = await saveDraft(caseId, draft);
  await store.saveDocument({ ...document, status: "superseded" });
  await store.addEvent(caseId, "letter_edited", { documentId, previousDocumentId: document.id, reset: input.reset });
  return (await loadCase(caseId))!;
}

/** Reopens an unsent review for corrections, preserving documents and superseded drafts in its history.
 * Refuses cases with recorded approvals or correspondence so editing cannot rewrite an active dispute.
 * @param caseId - Existing case whose bill and EOB should be reconfirmed.
 * @returns Updated view with no current audit or draft.
 */
export async function reopenReview(caseId: string): Promise<CaseView> {
  const store = getStore();
  const c = await store.getCase(caseId);
  if (!c) throw new BadRequestError("Unknown case");
  if (
    c.events.some((e) =>
      [
        "approval_recorded",
        "dispute_sent",
        "response_recorded",
        "consent_given",
        "call_recorded",
        "document_requested",
        "follow_up_sent",
      ].includes(e.type),
    )
  )
    throw new BadRequestError(
      "This case already has recorded approvals or correspondence. Its confirmed documents cannot be reopened.",
    );
  const editable = c.documents.filter(
    (d) =>
      d.direction === "incoming" &&
      ["itemized_bill", "eob"].includes(d.docType),
  );
  if (!editable.some((d) => d.docType === "itemized_bill"))
    throw new BadRequestError("This case has no itemized bill to correct");
  // Invalidate before unlocking: interrupted work must not leave an old letter available to send.
  for (const d of c.documents.filter(
    (d) => d.direction === "outgoing" && d.draft && d.status !== "superseded",
  ))
    await store.saveDocument({ ...d, status: "superseded" });
  await store.addEvent(caseId, "review_reopened", {
    documentIds: editable.map((d) => d.id),
  });
  await store.saveFindings(caseId, []);
  for (const d of editable)
    await store.saveDocument({ ...d, status: "extracted", confirmed: null });
  await store.setCaseStatus(caseId, "intake");
  return (await loadCase(caseId))!;
}

/**
 * Loads a confirmed document of the expected kind from a case.
 *
 * @param caseId - Case the document must belong to (so documents from other cases, never matched
 *   against this one at confirmation, can't be audited together).
 * @param id - Document ID.
 * @param kind - "bill" or "eob".
 * @returns The confirmed value.
 * @throws {BadRequestError} When missing, on another case, or not yet confirmed.
 */
async function loadConfirmed<K extends "bill" | "eob">(caseId: string, id: string, kind: K): Promise<K extends "bill" ? ConfirmedBill : ConfirmedEob> {
  const doc = await getStore().getDocument(id);
  if (doc && doc.caseId !== caseId) throw new BadRequestError(`Document ${id} doesn't belong to this case`);
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
 * @returns Findings, verdict, the providers searched, and where the records came from (`recordsOrigin`).
 * @throws {BadRequestError} When a document isn't confirmed or isn't on this case.
 */
export async function auditCase(
  caseId: string,
  billId: string,
  eobId: string | null,
): Promise<AuditResponse> {
  const bill = await loadConfirmed(caseId, billId, "bill");
  const eob = eobId ? await loadConfirmed(caseId, eobId, "eob") : null;
  // Comparing a bill with an EOB from a different visit would produce false findings.
  if (eob) {
    const mismatch = billEobMismatches(bill, eob);
    if (mismatch.length)
      throw new BadRequestError(
        `This EOB doesn't look like it's for the same visit as the bill. ${mismatch.join(" ")} Upload the matching EOB, or check the bill without one.`,
      );
  }
  const { records, providers, origin, warnings } = await loadRecords(caseId, bill.patientName);
  const fresh = runAudit(bill, eob, records, providers);
  const store = getStore();
  // Merge so a rerun never erases a status set by a response or verification (MVP 2).
  const previous = (await store.getCase(caseId))?.findings ?? [];
  const findings = mergeFindings(previous, fresh.findings);
  const result = { findings, verdict: computeVerdict(bill, findings) };
  await store.saveFindings(caseId, result.findings);
  await store.setCaseStatus(caseId, "audited");
  await store.addEvent(caseId, "audit_run", {
    billId,
    eobId,
    findings: result.findings.map((f) => f.id),
    verdict: result.verdict,
    providers,
    recordsOrigin: origin,
    recordWarnings: warnings,
  });
  return {
    ...result,
    providers,
    recordsOrigin: origin,
    recordWarnings: warnings,
  };
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
  const bill = await loadConfirmed(caseId, billId, "bill");
  const eob = eobId ? await loadConfirmed(caseId, eobId, "eob") : null;
  const { records, providers } = await loadRecords(caseId, bill.patientName);
  const previous = (await getStore().getCase(caseId))?.findings ?? [];
  const merged = mergeFindings(
    previous,
    runAudit(bill, eob, records, providers).findings,
  );
  await getStore().saveFindings(caseId, merged);
  // The letter covers only issues still in question (withdrawn ones stay out).
  // The billing-office letter covers provider issues only; insurer issues go to the insurer.
  const active = merged.filter(
    (f) => !f.patientExcluded && f.status !== "withdrawn",
  );
  const findings = active.filter((f) => f.contact !== "insurer");
  // Only insurer issues: the letter goes to the insurer instead of the billing office.
  const forInsurer = active.filter((f) => f.contact === "insurer");
  if (!findings.length && forInsurer.length && eob) {
    const draft = draftInsurerLetter(bill, eob, forInsurer);
    const documentId = await saveDraft(caseId, draft);
    await getStore().addEvent(caseId, "letter_drafted", {
      kind: draft.kind,
      author: draft.author,
      documentId,
      findings: forInsurer.map((f) => f.id),
    });
    return draft;
  }
  if (!findings.length)
    throw new BadRequestError(
      "No potential issues were found, so there is nothing to dispute.",
    );
  const draft = await draftDisputeLetter(
    bill,
    findings,
    llmConfigured() ? undefined : null,
  );
  const documentId = await saveDraft(caseId, draft);
  await getStore().setCaseStatus(caseId, "letter_drafted");
  await getStore().addEvent(caseId, "letter_drafted", {
    kind: draft.kind,
    author: draft.author,
    documentId,
    findings: findings.map((f) => f.id),
  });
  return draft;
}

/**
 * Drafts an itemized-bill request from a balance statement's header.
 *
 * @param documentId - Balance statement document ID.
 * @param acknowledgeDocType - Patient confirmed it is a medical balance statement despite the type
 *   checks' doubts (`typeIssues`).
 * @returns The request draft.
 * @throws {BadRequestError} When the document is not a balance statement, or its type is in doubt
 *   and not acknowledged.
 */
export async function draftItemizedRequest(documentId: string, acknowledgeDocType = false): Promise<Draft> {
  const doc = await getStore().getDocument(documentId);
  if (!doc || doc.docType !== "balance_statement") throw new BadRequestError("An itemized-bill request needs a balance statement");
  const statement = doc.extraction as ExtractedBill;
  if (statement.typeIssues?.length && !acknowledgeDocType) {
    throw new BadRequestError(`Confirm this is a medical balance statement first: ${statement.typeIssues.join(" ")}`);
  }
  const h = statement.header;
  const draft = draftItemizedBillRequest({
    billingEntity: h.billingEntity.value ?? "the provider",
    patientName: h.patientName.value,
    accountNumber: h.accountNumber.value,
    serviceStart: h.serviceStart.value,
    serviceEnd: h.serviceEnd.value,
    amountDueCents: h.amountDue.value,
  });
  const draftId = await saveDraft(doc.caseId, draft);
  await getStore().setCaseStatus(doc.caseId, "request_drafted");
  await getStore().addEvent(doc.caseId, "request_drafted", { kind: draft.kind, documentId, draftId, ...(statement.typeIssues?.length ? { docTypeAcknowledged: statement.typeIssues } : {}) });
  return draft;
}

/**
 * Saves a draft as an outgoing document.
 *
 * @param caseId - Case ID.
 * @param draft - The draft exactly as returned to the patient.
 * @returns The new document ID.
 */
async function saveDraft(caseId: string, draft: Draft): Promise<string> {
  const id = newId("doc");
  await getStore().saveDocument({
    id,
    caseId,
    docType: draft.kind,
    direction: "outgoing",
    status: "drafted",
    fileName: null,
    storageKey: null,
    extraction: null,
    extractionMeta: null,
    confirmed: null,
    draft,
  });
  return id;
}

/** What `/api/appeals` returns: the criteria check and the drafted letter (MVP 5). */
export interface AppealResponse {
  /** Patient-confirmed notice values used by the deterministic evaluation and draft. */
  notice: ConfirmedDenial;
  evaluation: DenialEvaluation;
  draft: Draft;
  providers: string[];
  recordsOrigin: RecordsOrigin;
}

/**
 * Checks a confirmed denial letter against the patient's records and drafts the appeal (all criteria
 * met) or a documentation request to the provider (anything missing). Deterministic; no model.
 *
 * @param documentId - The confirmed denial letter document.
 * @returns Evaluation, draft, providers searched, and where the records came from.
 * @throws {BadRequestError} When the document isn't a confirmed denial letter or the policy is unknown.
 */
export async function appealDenial(
  documentId: string,
): Promise<AppealResponse> {
  const store = getStore();
  const doc = await store.getDocument(documentId);
  if (!doc || doc.docType !== "denial_letter")
    throw new BadRequestError("An appeal needs a denial letter");
  if (!doc.confirmed)
    throw new BadRequestError("Confirm the denial letter's details first");
  const denial = doc.confirmed as ConfirmedDenial;
  const { records, origin } = await loadRecords(doc.caseId, denial.memberName);
  const evaluation = evaluateDenial(denial, records);
  if (!evaluation.policyKnown) {
    throw new BadRequestError(
      `We can't check policy ${denial.policyId ?? "(none)"} yet, so no appeal was drafted. A human advocate can review this denial.`,
    );
  }
  const draft = evaluation.allMet
    ? draftAppealLetter(denial, evaluation)
    : draftDocumentationRequest(denial, evaluation);
  const draftId = await saveDraft(doc.caseId, draft);
  await store.addEvent(doc.caseId, "appeal_evaluated", {
    documentId,
    policyId: evaluation.policy?.id,
    criteria: evaluation.criteria.map((c) => ({
      id: c.id,
      status: c.status,
      records: c.evidence.map((r) => r.recordId),
    })),
    allMet: evaluation.allMet,
    draftId,
    recordsOrigin: origin,
    response: {
      notice: denial,
      evaluation,
      draft,
      providers: evaluation.providers,
      recordsOrigin: origin,
    },
  });
  return {
    notice: denial,
    evaluation,
    draft,
    providers: evaluation.providers,
    recordsOrigin: origin,
  };
}

/**
 * Rebuilds the ingest response for a stored incoming bill or EOB.
 *
 * @param doc - Stored document.
 * @returns The ingest response, or `null` for documents the app can't show (outgoing, unsupported).
 */
function ingestOf(doc: StoredDocument): IngestResponse | null {
  if (doc.direction !== "incoming" || !doc.extraction) return null;
  const meta = doc.extractionMeta as ExtractionResult["meta"];
  const result: ExtractionResult =
    doc.docType === "eob"
      ? { kind: "eob", eob: doc.extraction as ExtractedEob, meta }
      : doc.docType === "denial_letter"
        ? { kind: "denial", denial: doc.extraction as ExtractedDenial, meta }
        : { kind: "bill", bill: doc.extraction as ExtractedBill, meta };
  return {
    caseId: doc.caseId,
    documentId: doc.id,
    result,
    attention: attentionOf(result),
  };
}

/**
 * Loads a saved case so the app can resume it after a reload or on another device.
 *
 * Reads only stored data: no model calls, and the audit is not re-run (findings and verdict come
 * from the latest `audit_run`).
 *
 * @param caseId - Case ID.
 * @returns The case view, or `null` if the case doesn't exist.
 */
export async function loadCase(caseId: string): Promise<CaseView | null> {
  const c = await getStore().getCase(caseId);
  if (!c) return null;
  const documents = c.documents.flatMap((d) => {
    const ingest = ingestOf(d);
    const attachment = c.events
      .filter((e) => e.type === "case_document_attached")
      .map((e) => e.data as { documentId: string; taskId?: string })
      .find((e) => e.documentId === d.id);
    return ingest
      ? [
          {
            ingest,
            confirmed: d.confirmed != null,
            ...(d.docType === "denial_letter" && d.confirmed
              ? {
                  confirmedValues: Object.fromEntries(
                    DENIAL_KEYS.map((key) => [
                      `fields.${key}`,
                      (d.confirmed as ConfirmedDenial)[key],
                    ]),
                  ),
                }
              : {}),
            fileName: d.fileName,
            ...(attachment?.taskId ? { taskId: attachment.taskId } : {}),
          },
        ]
      : [];
  });
  const currentEvents = c.events.slice(
    c.events.findLastIndex((e) => e.type === "review_reopened") + 1,
  );
  const lastAudit = currentEvents.filter((e) => e.type === "audit_run").at(-1)
    ?.data as
    | {
        billId?: string;
        findings: string[];
        verdict: Verdict;
        providers?: string[];
        recordsOrigin?: RecordsOrigin;
        recordWarnings?: string[];
      }
    | undefined;
  let audit: AuditResponse | null = null;
  if (lastAudit) {
    const byId = new Map(c.findings.map((f): [string, Finding] => [f.id, f]));
    const ordered = lastAudit.findings.flatMap((id) => byId.get(id) ?? []);
    audit = {
      findings: ordered,
      verdict: lastAudit.billId
        ? computeVerdict(await loadConfirmed(c.id, lastAudit.billId, "bill"), ordered)
        : lastAudit.verdict,
      providers: lastAudit.providers ?? [],
      recordsOrigin: lastAudit.recordsOrigin,
      recordWarnings: lastAudit.recordWarnings,
    };
  }
  const lastDraft = c.documents
    .filter(
      (d) => d.direction === "outgoing" && d.status !== "superseded" && d.draft,
    )
    .at(-1);
  return {
    caseId: c.id,
    status: c.status,
    documents,
    audit,
    draft: (lastDraft?.draft as Draft | undefined) ?? null,
    appeal: (() => {
      const event = c.events.filter((e) => e.type === "appeal_evaluated").at(-1)
        ?.data as { documentId: string; response?: AppealResponse } | undefined;
      return event?.response
        ? { ...event.response, draft: lastDraft && ["appeal_letter", "documentation_request"].includes(lastDraft.docType) ? lastDraft.draft as Draft : event.response.draft, documentId: event.documentId }
        : null;
    })(),
    state: caseStateOf(c),
  };
}
