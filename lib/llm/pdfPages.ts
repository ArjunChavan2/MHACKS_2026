/**
 * @file Renders documents to PNG page images for providers that read images but not PDFs (Grok).
 *
 * PDFs are rendered with PDF.js (`pdfjs-dist`) through `unpdf` on `@napi-rs/canvas`. Images other
 * than PNG or JPEG (e.g. WebP) are re-encoded as PNG. Server-only: uses a native canvas module.
 */
import { join } from "node:path";
import { definePDFJSModule, getDocumentProxy, renderPageAsImage } from "unpdf";
import type { FilePart } from "./index";

/** Render scale: 2× the PDF's 72 dpi gives ~144 dpi, enough for small print on bills. */
export const RENDER_SCALE = 2;

/** One-time switch of `unpdf` to the full PDF.js build, which supports rendering. */
let pdfjsReady: Promise<void> | null = null;

/**
 * PDF.js's bundled font outlines. Bills often use non-embedded standard fonts (e.g. Courier); without
 * these files PDF.js falls back to system fonts, and serverless Linux has none, so text renders blank.
 * Traced into the deploy by `outputFileTracingIncludes` in `next.config.ts`.
 */
const STANDARD_FONTS = join(process.cwd(), "node_modules", "pdfjs-dist", "standard_fonts") + "/";

/** Image types Grok accepts directly. */
const DIRECT_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/jpg"]);

/** A page image ready to send to a model. */
export interface PageImage {
  /** "image/png" or "image/jpeg". */
  mimeType: string;
  /** Encoded image bytes. */
  bytes: Uint8Array;
}

/**
 * Renders every page of a PDF to PNG.
 *
 * Side effects: loads PDF.js and the native canvas module on first use.
 *
 * @param bytes - PDF bytes (not modified).
 * @param scale - Render scale relative to 72 dpi.
 * @returns One PNG per page, in page order.
 */
export async function renderPdfPages(bytes: Uint8Array, scale = RENDER_SCALE): Promise<PageImage[]> {
  pdfjsReady ??= definePDFJSModule(() => import("pdfjs-dist/legacy/build/pdf.mjs"));
  await pdfjsReady;
  const pdf = await getDocumentProxy(bytes.slice(), { standardFontDataUrl: STANDARD_FONTS, disableFontFace: true });
  const pages: PageImage[] = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    const png = await renderPageAsImage(pdf, n, { canvasImport: () => import("@napi-rs/canvas"), scale });
    pages.push({ mimeType: "image/png", bytes: new Uint8Array(png as ArrayBuffer) });
  }
  return pages;
}

/**
 * Turns an uploaded file into page images: renders PDFs, passes PNG/JPEG through, and re-encodes
 * other image types as PNG.
 *
 * @param file - Uploaded file.
 * @returns Page images in order (one for a photo).
 * @throws {Error} When the image type cannot be decoded (e.g. HEIC).
 */
export async function toPageImages(file: FilePart): Promise<PageImage[]> {
  if (file.mimeType === "application/pdf") return renderPdfPages(file.bytes);
  if (DIRECT_IMAGE_TYPES.has(file.mimeType)) {
    return [{ mimeType: file.mimeType === "image/jpg" ? "image/jpeg" : file.mimeType, bytes: file.bytes }];
  }
  const { createCanvas, loadImage } = await import("@napi-rs/canvas");
  const img = await loadImage(Buffer.from(file.bytes));
  const canvas = createCanvas(img.width, img.height);
  canvas.getContext("2d").drawImage(img, 0, 0);
  return [{ mimeType: "image/png", bytes: new Uint8Array(canvas.toBuffer("image/png")) }];
}
