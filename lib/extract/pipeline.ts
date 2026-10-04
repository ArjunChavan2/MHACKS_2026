/**
 * @file The extraction pipeline: classify, extract, normalize, check (SPEC.md §4.2).
 *
 * The model proposes (transcribes), code verifies (normalization and checks), and the patient
 * confirms later (`confirm.ts`). Long PDFs are split into chunks of `PAGES_PER_CALL` pages and the
 * replies merged. Every result records the model, prompt version, and schema version for
 * traceability (step 9).
 */
import { PDFDocument } from "pdf-lib";
import {
  DOCUMENT_SYSTEM_INSTRUCTION,
  GEMINI_MODEL,
  PROMPT_VERSION,
  generateJson,
  type FilePart,
  type LlmClient,
} from "@/lib/llm";
import type { DocType, ExtractedBill, ExtractedEob } from "@/lib/types";
import { buildBill, buildEob } from "./build";
import {
  CLASSIFICATION_JSON_SCHEMA,
  ClassificationSchema,
  RAW_BILL_JSON_SCHEMA,
  RAW_EOB_JSON_SCHEMA,
  RawBillSchema,
  RawEobSchema,
  type Classification,
  type RawBill,
  type RawEob,
} from "./schemas";
import { readTextLayer, type TextLayer } from "./textLayer";

/** Schema version stored with each extraction; bump when `schemas.ts` changes shape. */
export const SCHEMA_VERSION = "raw-v1";

/** Maximum pages sent to the model in one extraction call (SPEC.md §4.2 step 3). */
export const PAGES_PER_CALL = 4;

/** Traceability metadata stored with every extraction (SPEC.md §4.2 step 9). */
export interface ExtractionMeta {
  model: string;
  promptVersion: string;
  schemaVersion: string;
  /** Whether the PDF text-layer cross-check ran (false for photos and scans). */
  textLayerChecked: boolean;
  /** Raw model replies, in call order. */
  rawReplies: string[];
  /** "gemini" for live extraction, "saved-fixture" for the labeled no-AI path. */
  source: "gemini" | "saved-fixture";
}

/** Result of extracting one uploaded document. */
export type ExtractionResult =
  | { kind: "bill"; bill: ExtractedBill; meta: ExtractionMeta }
  | { kind: "eob"; eob: ExtractedEob; meta: ExtractionMeta }
  | { kind: "unsupported"; docType: DocType; reason: string; meta: ExtractionMeta };

/**
 * Classifies a document before extraction (step 1).
 *
 * Side effects: one model call.
 *
 * @param file - The uploaded file.
 * @param client - Model client (injectable for tests).
 * @returns The classification and the raw reply.
 */
export async function classify(file: FilePart, client?: LlmClient): Promise<{ value: Classification; rawText: string }> {
  return generateJson(
    {
      system: DOCUMENT_SYSTEM_INSTRUCTION,
      prompt:
        "Classify this document. itemized_bill = lists individual charges with codes; balance_statement = shows a balance due without line items; eob = explanation of benefits from an insurer (says it is not a bill); revised_statement = a corrected bill; denial_letter = an insurer letter denying coverage. List every distinct billing entity: a provider (hospital, clinic, physician group) that charges the patient. An insurer or health plan is never a billing entity; for an eob, list the provider(s) whose claims it describes.",
      files: [file],
      jsonSchema: CLASSIFICATION_JSON_SCHEMA,
      validator: ClassificationSchema,
    },
    client,
  );
}

/**
 * Splits a PDF into chunks of at most `PAGES_PER_CALL` pages.
 *
 * @param bytes - PDF bytes.
 * @returns Chunks with the page offset of each chunk's first page (0-based offset).
 */
export async function splitPdf(bytes: Uint8Array): Promise<Array<{ bytes: Uint8Array; offset: number }>> {
  const src = await PDFDocument.load(bytes);
  const total = src.getPageCount();
  if (total <= PAGES_PER_CALL) return [{ bytes, offset: 0 }];
  const chunks: Array<{ bytes: Uint8Array; offset: number }> = [];
  for (let start = 0; start < total; start += PAGES_PER_CALL) {
    const out = await PDFDocument.create();
    const idx = Array.from({ length: Math.min(PAGES_PER_CALL, total - start) }, (_, i) => start + i);
    (await out.copyPages(src, idx)).forEach((p) => out.addPage(p));
    chunks.push({ bytes: await out.save(), offset: start });
  }
  return chunks;
}

/**
 * Shifts page numbers in a raw reply by a chunk offset so they refer to the original document.
 *
 * Mutates `node` in place (walks every object with a `page` number).
 *
 * @param node - Any part of a raw reply.
 * @param offset - Pages before this chunk.
 */
function shiftPages(node: unknown, offset: number): void {
  if (!node || typeof node !== "object" || offset === 0) return;
  if (Array.isArray(node)) return node.forEach((n) => shiftPages(n, offset));
  const rec = node as Record<string, unknown>;
  if (typeof rec.page === "number") rec.page += offset;
  Object.values(rec).forEach((v) => shiftPages(v, offset));
}

/**
 * Merges raw bill replies from several chunks: header from the first chunk that read each field,
 * lines concatenated in order.
 *
 * @param parts - Raw bill replies in page order.
 * @returns One merged raw bill.
 */
export function mergeBills(parts: RawBill[]): RawBill {
  const merged: RawBill = structuredClone(parts[0]);
  for (const p of parts.slice(1)) {
    for (const [k, f] of Object.entries(p.header) as Array<[keyof RawBill["header"], RawBill["header"][keyof RawBill["header"]]]>) {
      if (merged.header[k].status !== "read" && f.status === "read") merged.header[k] = f;
    }
    merged.lines.push(...p.lines);
  }
  return merged;
}

/**
 * Extracts one uploaded document end to end (steps 1–6).
 *
 * Side effects: model calls; reads the PDF text layer.
 *
 * @param file - Uploaded file (PDF or image).
 * @param client - Model client (injectable for tests).
 * @returns A checked bill or EOB, or `unsupported` with a plain reason (e.g. denial letters are MVP 5).
 * @throws {import("@/lib/llm").LlmUnavailableError} When no API key is configured.
 * @throws {import("@/lib/llm").LlmInvalidOutputError} When the model's reply fails validation twice.
 */
export async function extractDocument(file: FilePart, client?: LlmClient): Promise<ExtractionResult> {
  const isPdf = file.mimeType === "application/pdf";
  const layer: TextLayer = isPdf ? await readTextLayer(file.bytes) : null;
  const rawReplies: string[] = [];
  const meta = (): ExtractionMeta => ({
    model: GEMINI_MODEL,
    promptVersion: PROMPT_VERSION,
    schemaVersion: SCHEMA_VERSION,
    textLayerChecked: layer !== null,
    rawReplies,
    source: "gemini",
  });

  const c = await classify(file, client);
  rawReplies.push(c.rawText);
  const { docType, billingEntities } = c.value;

  if (docType === "denial_letter") {
    return { kind: "unsupported", docType, reason: "Denial appeals are a later stage (SPEC.md §4.10).", meta: meta() };
  }
  if (docType === "unknown") {
    return { kind: "unsupported", docType, reason: "This doesn't look like a medical bill or an EOB. Try another file.", meta: meta() };
  }
  if (billingEntities.length > 1) {
    // Splitting multi-entity documents is specified (SPEC.md §4.2 step 1) but not built in MVP 1.
    return {
      kind: "unsupported",
      docType,
      reason: `This document has charges from several billing entities (${billingEntities.join(", ")}). Upload each provider's bill separately for now.`,
      meta: meta(),
    };
  }

  const chunks = isPdf ? await splitPdf(file.bytes) : [{ bytes: file.bytes, offset: 0 }];
  const prompt = (type: string) =>
    `This document is a ${type}. Transcribe every field in the schema. Remember: copy values exactly as printed; never calculate or infer.`;

  if (docType === "eob") {
    const parts: RawEob[] = [];
    for (const ch of chunks) {
      const r = await generateJson(
        { system: DOCUMENT_SYSTEM_INSTRUCTION, prompt: prompt("explanation of benefits"), files: [{ mimeType: file.mimeType, bytes: ch.bytes }], jsonSchema: RAW_EOB_JSON_SCHEMA, validator: RawEobSchema },
        client,
      );
      shiftPages(r.value, ch.offset);
      rawReplies.push(r.rawText);
      parts.push(r.value);
    }
    const merged: RawEob = { ...structuredClone(parts[0]), lines: parts.flatMap((p) => p.lines) };
    return { kind: "eob", eob: buildEob(merged, layer), meta: meta() };
  }

  const parts: RawBill[] = [];
  for (const ch of chunks) {
    const r = await generateJson(
      { system: DOCUMENT_SYSTEM_INSTRUCTION, prompt: prompt(docType.replace("_", " ")), files: [{ mimeType: file.mimeType, bytes: ch.bytes }], jsonSchema: RAW_BILL_JSON_SCHEMA, validator: RawBillSchema },
      client,
    );
    shiftPages(r.value, ch.offset);
    rawReplies.push(r.rawText);
    parts.push(r.value);
  }
  return { kind: "bill", bill: buildBill(mergeBills(parts), layer), meta: meta() };
}

/**
 * Builds an extraction from a saved fixture reply, for the labeled no-AI demo path
 * (SPEC.md §6 MVP 1 "If behind"). Runs the same normalization and checks as live extraction.
 *
 * @param raw - Saved raw reply (bill or EOB).
 * @param pdfBytes - The matching fixture PDF, so the text-layer check runs too.
 * @returns A checked bill or EOB marked `source: "saved-fixture"`.
 */
export async function extractFromSavedReply(raw: unknown, pdfBytes: Uint8Array): Promise<ExtractionResult> {
  const layer = await readTextLayer(pdfBytes);
  const meta: ExtractionMeta = {
    model: "none",
    promptVersion: PROMPT_VERSION,
    schemaVersion: SCHEMA_VERSION,
    textLayerChecked: layer !== null,
    rawReplies: [JSON.stringify(raw)],
    source: "saved-fixture",
  };
  const eob = RawEobSchema.safeParse(raw);
  if (eob.success) return { kind: "eob", eob: buildEob(eob.data, layer), meta };
  return { kind: "bill", bill: buildBill(RawBillSchema.parse(raw), layer), meta };
}
