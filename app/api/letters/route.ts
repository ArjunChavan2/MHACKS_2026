/**
 * @file POST /api/letters: draft the dispute letter from server-side findings (SPEC.md §4.5).
 */
import { z } from "zod";
import { errorResponse, parseBody } from "@/lib/http";
import { draftLetter } from "@/lib/cases/service";

/** Request body. */
const Body = z.object({ caseId: z.string(), billId: z.string(), eobId: z.string().nullable() });

/**
 * Drafts the letter.
 *
 * @param req - JSON `{ caseId, billId, eobId }`.
 * @returns JSON `{ draft }` or an error.
 */
export async function POST(req: Request): Promise<Response> {
  try {
    const { caseId, billId, eobId } = await parseBody(req, Body);
    return Response.json({ draft: await draftLetter(caseId, billId, eobId) });
  } catch (err) {
    return errorResponse(err);
  }
}
