/** @file Browser-safe confirmation progress; tracks review actions, never clinical findings or server approval. */
import type { Field } from "@/lib/types";
import { parseMoney } from "./normalize";

/** One document field's local review requirement. */
export interface ReviewItem {
  /** Field path used by the confirmation API. */ path: string;
  /** Whether a required value has not been provided. */ missing: boolean;
  /** Whether the patient reviewed this item; edits still need server validation. */ reviewed: boolean;
  /** Server-returned validation messages tied to this field. */ errors: string[];
}

/**
 * Identifies unfinished fields using extraction flags, patient actions and server failures.
 * Missing bill charges cannot be waived by confirming the printed value.
 * @param fields - Original extraction field/path pairs.
 * @param corrections - Local raw edits.
 * @param confirmedPaths - Explicit patient confirmations.
 * @param blocking - Latest server validation failures; cleared when the patient edits.
 * @returns Review items in document order. Reviewed does not mean valid or confirmed.
 */
export function reviewItems(
  fields: Array<[string, Field<unknown>]>,
  corrections: Record<string, string | null>,
  confirmedPaths: string[],
  blocking: string[],
): ReviewItem[] {
  return fields.flatMap(([path, field]) => {
    const raw = path in corrections ? corrections[path] : field.raw;
    const requiredCharge = /^lines\.\d+\.charge$/.test(path);
    const missing = requiredCharge
      ? raw == null || parseMoney(raw) === null
      : field.verification === "needs_attention" &&
        !confirmedPaths.includes(path) &&
        !(raw ?? "").trim();
    const errors = blocking.filter(
      (message) =>
        field.issues.includes(message) ||
        (requiredCharge &&
          message ===
            `Line ${Number(path.split(".")[1]) + 1}: a charge amount is required`),
    );
    if (field.verification !== "needs_attention" && !missing && !errors.length)
      return [];
    const edited = path in corrections && corrections[path] !== field.raw;
    const reviewed =
      !missing && !errors.length && (confirmedPaths.includes(path) || edited);
    return [{ path, missing, reviewed, errors }];
  });
}
