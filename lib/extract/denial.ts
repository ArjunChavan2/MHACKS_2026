/**
 * @file Insurance denial letters (SPEC.md §4.10, MVP 5): raw schema, normalization, checks, and
 * patient confirmation. The model only transcribes the printed values; code normalizes and checks
 * them; the patient confirms every flagged field before the criteria engine sees anything.
 */
import { z } from "zod";
import type { ConfirmedDenial, DenialKey, ExtractedDenial, Field } from "@/lib/types";
import { applyTextLayer, flag } from "./checks";
import { blockingFields, rawOf, type ConfirmInput, type ConfirmResult } from "./confirm";
import { parseDate, parseText, toField } from "./normalize";
import { RawFieldSchema } from "./schemas";
import type { TextLayer } from "./textLayer";

/** Every field read from a denial letter, in display order. */
export const DENIAL_KEYS: readonly DenialKey[] = [
  "insurer", "memberName", "memberId", "referenceNumber", "letterDate", "deniedService", "serviceCode",
  "plannedDate", "provider", "denialReason", "policyId", "appealDeadline", "appealAddress",
];

/** Fields that hold dates (normalized to ISO). */
const DATE_KEYS = new Set<DenialKey>(["letterDate", "plannedDate", "appealDeadline"]);

/** Raw denial reply from the model. */
export const RawDenialSchema = z.object({
  docType: z.literal("denial_letter"),
  ...Object.fromEntries(DENIAL_KEYS.map((k) => [k, RawFieldSchema])),
}) as unknown as z.ZodType<{ docType: "denial_letter" } & Record<DenialKey, z.infer<typeof RawFieldSchema>>>;

/** A raw denial reply. */
export type RawDenial = { docType: "denial_letter" } & Record<DenialKey, z.infer<typeof RawFieldSchema>>;

/** JSON Schema for the raw denial reply (sent to the model). */
export const RAW_DENIAL_JSON_SCHEMA = {
  type: "object",
  properties: {
    docType: { type: "string", enum: ["denial_letter"] },
    ...Object.fromEntries(
      DENIAL_KEYS.map((k) => [
        k,
        {
          type: "object",
          properties: {
            raw: { type: ["string", "null"] },
            page: { type: ["integer", "null"] },
            snippet: { type: ["string", "null"] },
            status: { type: "string", enum: ["read", "unreadable", "absent"] },
          },
          required: ["raw", "page", "snippet", "status"],
        },
      ]),
    ),
  },
  required: ["docType", ...DENIAL_KEYS],
};

/** Human labels for the confirm screen and issue messages. */
export const DENIAL_LABELS: Record<DenialKey, string> = {
  insurer: "Insurer",
  memberName: "Member name",
  memberId: "Member ID",
  referenceNumber: "Reference number",
  letterDate: "Letter date",
  deniedService: "Denied service",
  serviceCode: "Service code",
  plannedDate: "Planned service date",
  provider: "Provider",
  denialReason: "Denial reason",
  policyId: "Policy",
  appealDeadline: "Appeal deadline",
  appealAddress: "Where to send the appeal",
};

/**
 * Lists a denial's fields with path labels (for checks and the confirm screen).
 *
 * @param d - Extracted denial.
 * @returns `[path, field]` pairs in display order, paths like `fields.letterDate`.
 */
export function denialFields(d: ExtractedDenial): Array<[string, Field<unknown>]> {
  return DENIAL_KEYS.map((k) => [`fields.${k}`, d.fields[k] as Field<unknown>]);
}

/**
 * Normalizes and checks a raw denial reply.
 *
 * Checks: dates parse; the appeal deadline is after the letter date; the policy ID is present
 * (criteria can't be looked up without it). Mutates nothing it receives.
 *
 * @param raw - Validated raw reply.
 * @param layer - PDF text layer, or `null` for photos.
 * @returns The extracted denial with verification set on every field.
 */
export function buildDenial(raw: RawDenial, layer: TextLayer): ExtractedDenial {
  const fields = Object.fromEntries(
    DENIAL_KEYS.map((k) => [k, toField<string>(raw[k], DATE_KEYS.has(k) ? parseDate : parseText, DENIAL_LABELS[k])]),
  ) as Record<DenialKey, Field<string>>;
  const denial: ExtractedDenial = { docType: "denial_letter", fields, documentIssues: [] };
  applyTextLayer(denialFields(denial), layer);
  const { letterDate, appealDeadline, policyId } = fields;
  if (letterDate.value && appealDeadline.value && appealDeadline.value <= letterDate.value) {
    flag(appealDeadline, "The appeal deadline is not after the letter date");
  }
  if (!policyId.value && policyId.status !== "unreadable") flag(policyId, "No policy is named, so the insurer's criteria can't be checked");
  return denial;
}

/**
 * Confirms a denial: applies corrections, rebuilds, and locks it when nothing blocks.
 *
 * @param extracted - Extracted denial.
 * @param input - Corrections and paths confirmed as printed.
 * @returns The confirmed denial, or the blocking reasons.
 */
export function confirmDenial(extracted: ExtractedDenial, input: ConfirmInput): ConfirmResult<ConfirmedDenial> {
  const raw = {
    docType: "denial_letter" as const,
    ...Object.fromEntries(DENIAL_KEYS.map((k) => [k, rawOf(extracted.fields[k] as Field<unknown>, `fields.${k}`, input.corrections)])),
  } as RawDenial;
  const rebuilt = buildDenial(raw, null);
  const blocking = blockingFields(denialFields(rebuilt), input);
  if (blocking.length) return { ok: false, blocking: [...new Set(blocking)] };
  const v = (k: DenialKey) => rebuilt.fields[k].value;
  return {
    ok: true,
    value: Object.freeze({
      confirmed: true as const,
      documentId: input.documentId,
      insurer: v("insurer"),
      memberName: v("memberName"),
      memberId: v("memberId"),
      referenceNumber: v("referenceNumber"),
      letterDate: v("letterDate"),
      deniedService: v("deniedService"),
      serviceCode: v("serviceCode"),
      plannedDate: v("plannedDate"),
      provider: v("provider"),
      denialReason: v("denialReason"),
      policyId: v("policyId"),
      appealDeadline: v("appealDeadline"),
      appealAddress: v("appealAddress"),
    }),
  };
}
