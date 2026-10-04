/**
 * @file Proves upload intake (GitHub issue #5, weak spots 4 and 6): the type comes from the bytes,
 * oversized or unreadable PDFs are refused before any model call, and HEIC is converted or refused
 * with a clear message.
 */
import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { MAX_PDF_PAGES, UploadRejectedError, prepareUpload, sniffFileType } from "@/lib/extract/upload";
import { fixturePdf } from "../helpers";

/**
 * Builds an ISO-BMFF "ftyp" header with the given brands.
 *
 * @param major - Major brand.
 * @param compatible - Compatible brands.
 * @returns Header bytes (not a decodable image).
 */
function ftyp(major: string, compatible: string[]): Uint8Array {
  const brands = [major, "\0\0\0\0", ...compatible].join("");
  const size = 8 + brands.length;
  const b = new Uint8Array(size + 16);
  new DataView(b.buffer).setUint32(0, size);
  b.set(new TextEncoder().encode(`ftyp${brands}`), 4);
  return b;
}

/**
 * Builds a blank PDF.
 *
 * @param pages - Page count.
 * @returns PDF bytes.
 */
async function blankPdf(pages: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) doc.addPage();
  return doc.save();
}

describe("sniffFileType", () => {
  /** Proves each accepted type is recognized from its bytes. */
  it("recognizes accepted types by their bytes", () => {
    expect(sniffFileType(fixturePdf("sample-bill"))).toBe("application/pdf");
    expect(sniffFileType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0]))).toBe("image/jpeg");
    expect(sniffFileType(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]))).toBe("image/png");
    expect(sniffFileType(new TextEncoder().encode("RIFF\0\0\0\0WEBPVP8 "))).toBe("image/webp");
    expect(sniffFileType(ftyp("heic", ["mif1", "heic"]))).toBe("image/heic");
    expect(sniffFileType(ftyp("mif1", ["heic"]))).toBe("image/heic");
  });
  /** Proves anything else is refused, whatever the browser called it (AVIF, text, executables, MP4). */
  it("refuses everything else", () => {
    expect(sniffFileType(ftyp("avif", ["mif1", "avif"]))).toBeNull();
    expect(sniffFileType(ftyp("isom", ["mp41"]))).toBeNull();
    expect(sniffFileType(new TextEncoder().encode("Invoice #12 total $40"))).toBeNull();
    expect(sniffFileType(new TextEncoder().encode("MZ\x90\0"))).toBeNull();
    expect(sniffFileType(new Uint8Array())).toBeNull();
  });
});

describe("prepareUpload", () => {
  /** Proves a non-document is refused with a patient-readable message. */
  it("refuses a file that isn't a PDF or photo", async () => {
    await expect(prepareUpload(new TextEncoder().encode("<html>bill</html>"))).rejects.toThrow(UploadRejectedError);
  });
  /** Proves the page limit: at the limit passes, one over is refused before any model call. */
  it("enforces the PDF page limit", async () => {
    expect((await prepareUpload(await blankPdf(MAX_PDF_PAGES))).pages).toBe(MAX_PDF_PAGES);
    await expect(prepareUpload(await blankPdf(MAX_PDF_PAGES + 1))).rejects.toThrow(`has ${MAX_PDF_PAGES + 1} pages; the limit is ${MAX_PDF_PAGES}`);
  });
  /** Proves a damaged PDF is refused cleanly instead of failing later with a server error. */
  it("refuses a PDF that can't be opened", async () => {
    await expect(prepareUpload(new TextEncoder().encode("%PDF-1.7\nnot really a pdf"))).rejects.toThrow(/can't be opened/);
  });
  /** Proves PDFs and PNG/JPEG pass through unchanged, typed by their bytes. */
  it("passes valid PDFs and photos through", async () => {
    const pdf = fixturePdf("sample-bill");
    const r = await prepareUpload(pdf);
    expect(r).toMatchObject({ mimeType: "application/pdf", pages: 1, convertedFromHeic: false });
    expect(r.bytes).toBe(pdf);
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]);
    expect((await prepareUpload(png)).mimeType).toBe("image/png");
  });
  /** Proves a HEIC that can't be decoded gets a clear message instead of failing in the Grok path. */
  it("refuses an undecodable HEIC with a clear message", async () => {
    await expect(prepareUpload(ftyp("heic", ["mif1", "heic"]))).rejects.toThrow(/HEIC photo couldn't be read/);
  });
});
