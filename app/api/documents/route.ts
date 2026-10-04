/**
 * @file POST /api/documents: upload a bill, EOB, or statement for AI extraction (SPEC.md §4.2).
 *
 * Multipart form with `file` and optional `caseId`. Returns the checked extraction for the confirm
 * screen. Responds 503 `no_ai` when Gemini isn't configured (the client then offers samples).
 */
import { errorResponse } from "@/lib/http";
import { BadRequestError, ingestUpload } from "@/lib/cases/service";

/**
 * Handles an upload.
 *
 * @param req - Multipart request.
 * @returns JSON `IngestResponse` or an error.
 */
export async function POST(req: Request): Promise<Response> {
  try {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) throw new BadRequestError("Attach a file in the `file` field");
    if (file.size > 15 * 1024 * 1024) throw new BadRequestError("Files must be under 15 MB");
    const caseId = typeof form.get("caseId") === "string" && form.get("caseId") ? String(form.get("caseId")) : null;
    // The browser's file.type is ignored: the type is detected from the bytes (lib/extract/upload.ts).
    return Response.json(await ingestUpload(caseId, file.name, new Uint8Array(await file.arrayBuffer())));
  } catch (err) {
    return errorResponse(err);
  }
}
