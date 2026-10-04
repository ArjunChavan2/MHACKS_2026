/**
 * @file PDF text-layer cross-check (SPEC.md §4.2 step 4).
 *
 * For PDFs with a real text layer, every extracted value must appear in the PDF's own text near its
 * cited snippet. Photos and scans have no text layer; for them this check is skipped and the
 * confirm screen is stricter.
 */
import { extractText } from "unpdf";

/** Per-page text of a PDF, whitespace-normalized; `null` when the file has no usable text layer. */
export type TextLayer = string[] | null;

/**
 * Collapses runs of whitespace to single spaces and trims, so comparisons ignore layout spacing.
 *
 * Pure: no side effects.
 *
 * @param s - Any text.
 * @returns Normalized text.
 */
export function normalizeWs(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/**
 * Reads the text layer of a PDF.
 *
 * A PDF counts as having a text layer when it yields at least 20 non-space characters; scanned
 * PDFs usually yield none.
 *
 * @param bytes - PDF file bytes.
 * @returns Normalized text per page, or `null` for scans and unreadable files.
 */
export async function readTextLayer(bytes: Uint8Array): Promise<TextLayer> {
  try {
    const { text } = await extractText(new Uint8Array(bytes), { mergePages: false });
    const pages = (Array.isArray(text) ? text : [text]).map(normalizeWs);
    return pages.join("").replace(/\s/g, "").length >= 20 ? pages : null;
  } catch {
    return null;
  }
}

/**
 * Checks that a raw value and its snippet appear on the cited page of the text layer.
 *
 * Pure: no side effects.
 *
 * @param layer - Per-page normalized text.
 * @param page - 1-based page cited by the model.
 * @param raw - Value as transcribed.
 * @param snippet - Snippet as transcribed (optional).
 * @returns An issue message when the value or snippet is missing from the page; `null` when found.
 */
export function crossCheck(layer: string[], page: number | null, raw: string, snippet: string | null): string | null {
  if (page === null || page < 1 || page > layer.length) return "cited page does not exist in the PDF";
  const text = layer[page - 1];
  if (!text.includes(normalizeWs(raw))) return `"${raw}" does not appear on page ${page} of the PDF text`;
  if (snippet && !text.includes(normalizeWs(snippet))) return `cited snippet does not appear on page ${page}`;
  return null;
}
