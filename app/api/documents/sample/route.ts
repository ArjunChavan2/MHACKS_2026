/**
 * @file POST /api/documents/sample: load a saved synthetic document through the labeled no-AI
 * path (SPEC.md §6 MVP 1 "If behind"). Same normalization and checks as live extraction.
 */
import { z } from "zod";
import { errorResponse, parseBody } from "@/lib/http";
import { ingestSample } from "@/lib/cases/service";

/** Request body. */
const Body = z.object({ name: z.string(), caseId: z.string().nullable().optional() });

/**
 * Loads a sample document.
 *
 * @param req - JSON `{ name, caseId? }`.
 * @returns JSON `IngestResponse` or an error.
 */
export async function POST(req: Request): Promise<Response> {
  try {
    const { name, caseId } = await parseBody(req, Body);
    return Response.json(await ingestSample(caseId ?? null, name));
  } catch (err) {
    return errorResponse(err);
  }
}
