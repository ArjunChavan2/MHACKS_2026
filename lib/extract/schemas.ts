/**
 * @file Schemas for what the extraction model returns (SPEC.md §4.2 steps 1–3).
 *
 * The model only transcribes: every field is a `RawField` (raw text, page, snippet, status).
 * Code normalizes and checks afterwards. Each schema exists twice: a zod schema that validates the
 * reply locally, and a JSON Schema sent to Gemini as the required response format.
 */
import { z } from "zod";

/** One transcribed field: raw text as printed, where it was read, and how. */
export const RawFieldSchema = z.object({
  raw: z.string().nullable(),
  page: z.number().int().positive().nullable(),
  snippet: z.string().nullable(),
  status: z.enum(["read", "unreadable", "absent"]),
});

/** A transcribed field (see `RawFieldSchema`). */
export type RawField = z.infer<typeof RawFieldSchema>;

/** Classification reply (SPEC.md §4.2 step 1). */
export const ClassificationSchema = z.object({
  docType: z.enum([
    "itemized_bill",
    "balance_statement",
    "eob",
    "revised_statement",
    "denial_letter",
    "unknown",
  ]),
  /** Distinct billing entities found (a document with several is split, one bill per entity). */
  billingEntities: z.array(z.string()),
  /** Total number of pages in the document. */
  pageCount: z.number().int().positive(),
});

/** A classification reply. */
export type Classification = z.infer<typeof ClassificationSchema>;

/** Header field names of a bill. */
export const BILL_HEADER_KEYS = [
  "billingEntity",
  "providerType",
  "accountNumber",
  "patientName",
  "serviceStart",
  "serviceEnd",
  "encounter",
  "statementDate",
  "totalCharges",
  "totalAdjustments",
  "totalPayments",
  "amountDue",
] as const;

/** Line field names of a bill. */
export const BILL_LINE_KEYS = [
  "lineNumber",
  "serviceDate",
  "code",
  "codeType",
  "description",
  "quantity",
  "unitPrice",
  "charge",
  "adjustment",
  "patientResponsibility",
] as const;

/** EOB header field names. */
export const EOB_HEADER_KEYS = ["insurer", "claimNumber", "provider", "totalPatientResponsibility"] as const;

/** EOB line field names. */
export const EOB_LINE_KEYS = ["serviceDate", "code", "billed", "allowed", "planPaid", "patientResponsibility"] as const;

/**
 * Builds a zod object whose listed keys are all `RawField`s.
 *
 * @param keys - Field names.
 * @returns A strict-enough zod object schema.
 */
function rawObject<K extends string>(keys: readonly K[]) {
  return z.object(Object.fromEntries(keys.map((k) => [k, RawFieldSchema])) as Record<K, typeof RawFieldSchema>);
}

/** Raw bill reply (itemized bill, revised statement, or balance statement). */
export const RawBillSchema = z.object({
  docType: z.enum(["itemized_bill", "revised_statement", "balance_statement"]),
  header: rawObject(BILL_HEADER_KEYS),
  lines: z.array(rawObject(BILL_LINE_KEYS)),
});

/** A raw bill reply. */
export type RawBill = z.infer<typeof RawBillSchema>;

/** Raw EOB reply. */
export const RawEobSchema = z.object({
  docType: z.literal("eob"),
  ...rawObject(EOB_HEADER_KEYS).shape,
  lines: z.array(rawObject(EOB_LINE_KEYS)),
});

/** A raw EOB reply. */
export type RawEob = z.infer<typeof RawEobSchema>;

/** JSON Schema for one raw field, sent to Gemini. */
const RAW_FIELD_JSON = {
  type: "object",
  properties: {
    raw: { type: ["string", "null"] },
    page: { type: ["integer", "null"] },
    snippet: { type: ["string", "null"] },
    status: { type: "string", enum: ["read", "unreadable", "absent"] },
  },
  required: ["raw", "page", "snippet", "status"],
} as const;

/**
 * Builds a JSON Schema object whose listed keys are raw fields.
 *
 * @param keys - Field names.
 * @returns JSON Schema object definition.
 */
function rawObjectJson(keys: readonly string[]) {
  return {
    type: "object",
    properties: Object.fromEntries(keys.map((k) => [k, RAW_FIELD_JSON])),
    required: [...keys],
  };
}

/** JSON Schema for the classification reply. */
export const CLASSIFICATION_JSON_SCHEMA = {
  type: "object",
  properties: {
    docType: {
      type: "string",
      enum: ["itemized_bill", "balance_statement", "eob", "revised_statement", "denial_letter", "unknown"],
    },
    billingEntities: { type: "array", items: { type: "string" } },
    pageCount: { type: "integer" },
  },
  required: ["docType", "billingEntities", "pageCount"],
};

/** JSON Schema for the raw bill reply. */
export const RAW_BILL_JSON_SCHEMA = {
  type: "object",
  properties: {
    docType: { type: "string", enum: ["itemized_bill", "revised_statement", "balance_statement"] },
    header: rawObjectJson(BILL_HEADER_KEYS),
    lines: { type: "array", items: rawObjectJson(BILL_LINE_KEYS) },
  },
  required: ["docType", "header", "lines"],
};

/** JSON Schema for the raw EOB reply. */
export const RAW_EOB_JSON_SCHEMA = {
  type: "object",
  properties: {
    docType: { type: "string", enum: ["eob"] },
    ...rawObjectJson(EOB_HEADER_KEYS).properties,
    lines: { type: "array", items: rawObjectJson(EOB_LINE_KEYS) },
  },
  required: ["docType", ...EOB_HEADER_KEYS, "lines"],
};
