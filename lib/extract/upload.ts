/**
 * @file Upload intake checks before anything is stored or sent to a model (GitHub issue #5, weak
 * spots 4 and 6).
 *
 * The file type comes from the file's own bytes, never the browser's label. PDFs over
 * `MAX_PDF_PAGES` pages are refused, because each chunk of `PAGES_PER_CALL` pages is a model call
 * (and Grok sees every page as an image). HEIC photos (iPhone default) are converted to JPEG here,
 * because the Grok path can only pass PNG/JPEG through and the canvas can't decode HEIC, and
 * browsers can't preview HEIC on the confirm screen either.
 */
import convertHeic from "heic-convert";
import { PDFDocument } from "pdf-lib";

/** Most PDF pages one upload may have. 20 pages is 5 extraction calls plus classification. */
export const MAX_PDF_PAGES = 20;

/** File types the app accepts, as detected from the bytes. */
export type DetectedType = "application/pdf" | "image/jpeg" | "image/png" | "image/webp" | "image/heic";

/** Thrown when an upload is refused; routes map it to HTTP 400 with the message shown as is. */
export class UploadRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UploadRejectedError";
  }
}

/** HEIF brands of HEIC photos (HEVC-coded). AVIF ("avif", "avis") is a different codec and not accepted. */
const HEIC_BRANDS = new Set(["heic", "heix", "hevc", "hevx", "heim", "heis", "mif1", "msf1"]);

/**
 * Reads 4 bytes as ASCII.
 *
 * @param b - Bytes.
 * @param at - Offset.
 * @returns The 4 characters.
 */
function ascii4(b: Uint8Array, at: number): string {
  return String.fromCharCode(...b.subarray(at, at + 4));
}

/**
 * Detects a file's type from its leading bytes (magic numbers), ignoring its name and label.
 *
 * Pure: no side effects.
 *
 * @param b - File bytes.
 * @returns The detected type, or `null` when it is none of the accepted types.
 * @example sniffFileType(new TextEncoder().encode("%PDF-1.7 ...")) // "application/pdf"
 */
export function sniffFileType(b: Uint8Array): DetectedType | null {
  // PDF readers accept "%PDF-" anywhere in the first 1 KB (some files have junk before it).
  const head = new TextDecoder("latin1").decode(b.subarray(0, 1024));
  if (head.includes("%PDF-")) return "application/pdf";
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((x, i) => b[i] === x)) return "image/png";
  if (b.length >= 12 && ascii4(b, 0) === "RIFF" && ascii4(b, 8) === "WEBP") return "image/webp";
  if (b.length >= 12 && ascii4(b, 4) === "ftyp") {
    // ISO-BMFF: box size, "ftyp", major brand, minor version, then compatible brands.
    const size = Math.min(new DataView(b.buffer, b.byteOffset, 4).getUint32(0), b.length);
    const brands = [ascii4(b, 8)];
    for (let at = 16; at + 4 <= size; at += 4) brands.push(ascii4(b, at));
    if (brands[0] !== "avif" && brands.some((x) => HEIC_BRANDS.has(x))) return "image/heic";
  }
  return null;
}

/** An upload ready for storage and extraction. */
export interface PreparedUpload {
  /** Type detected from the bytes (HEIC becomes "image/jpeg" after conversion). */
  mimeType: Exclude<DetectedType, "image/heic">;
  bytes: Uint8Array;
  /** Page count for PDFs, 1 for photos. */
  pages: number;
  /** True when a HEIC photo was converted to JPEG. */
  convertedFromHeic: boolean;
}

/**
 * Checks and normalizes an upload: detects the real type, enforces the PDF page limit, and converts
 * HEIC to JPEG.
 *
 * @param bytes - Uploaded bytes (not modified).
 * @returns The prepared upload.
 * @throws {UploadRejectedError} For an unrecognized type, an unreadable or oversized PDF, or a HEIC
 *   photo that can't be decoded.
 */
export async function prepareUpload(bytes: Uint8Array): Promise<PreparedUpload> {
  const type = sniffFileType(bytes);
  if (!type) throw new UploadRejectedError("This file isn't a PDF or a photo (JPEG, PNG, WEBP, or HEIC). Upload the bill as a PDF or a photo.");
  if (type === "application/pdf") {
    let pages: number;
    try {
      pages = (await PDFDocument.load(bytes, { updateMetadata: false })).getPageCount();
    } catch {
      throw new UploadRejectedError("This PDF can't be opened. It may be password-protected or damaged. Try saving it again, or upload a photo.");
    }
    if (pages > MAX_PDF_PAGES) {
      throw new UploadRejectedError(
        `This PDF has ${pages} pages; the limit is ${MAX_PDF_PAGES}. Upload only the pages with the charges (or the summary and itemized pages).`,
      );
    }
    return { mimeType: type, bytes, pages, convertedFromHeic: false };
  }
  if (type === "image/heic") {
    try {
      const jpeg = await convertHeic({ buffer: bytes, format: "JPEG", quality: 0.92 });
      return { mimeType: "image/jpeg", bytes: new Uint8Array(jpeg), pages: 1, convertedFromHeic: true };
    } catch {
      throw new UploadRejectedError("This HEIC photo couldn't be read. Take a screenshot of it or export it as JPEG, then upload that.");
    }
  }
  return { mimeType: type, bytes, pages: 1, convertedFromHeic: false };
}
