/**
 * @file POST /api/appeals: check a confirmed denial letter against the patient's records and draft
 * the appeal or a documentation request (SPEC.md §4.10, MVP 5). Deterministic; nothing is sent.
 */
import { z } from "zod";
import { appealDenial } from "@/lib/cases/service";
import { errorResponse, parseBody } from "@/lib/http";

/** Request body. */
const Body = z.object({ documentId: z.string().min(1) });

/**
 * Runs the check and returns the evaluation and draft.
 *
 * @param req - Request with `{ documentId }`.
 * @returns JSON `AppealResponse`, or an error.
 */
export async function POST(req: Request): Promise<Response> {
  try {
    const { documentId } = await parseBody(req, Body);
    return Response.json(await appealDenial(documentId), { headers: { "Cache-Control": "private, no-store" } });
  } catch (err) {
    return errorResponse(err);
  }
}
