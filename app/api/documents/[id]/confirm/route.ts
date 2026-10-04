/**
 * @file POST /api/documents/[id]/confirm: lock the patient-confirmed fields (SPEC.md §4.2 step 7).
 *
 * Returns `{ ok: true }` or `{ ok: false, blocking }` listing what still needs fixing.
 */
import { z } from "zod";
import { errorResponse, parseBody } from "@/lib/http";
import { confirmDocument } from "@/lib/cases/service";

/** Request body. */
const Body = z.object({
  corrections: z.record(z.string(), z.string().nullable()),
  confirmedPaths: z.array(z.string()),
  acknowledgeTotalsMismatch: z.boolean(),
});

/**
 * Confirms a document.
 *
 * @param req - JSON body with corrections and confirmations.
 * @param ctx - Route context; `params` is async in Next.js 16.
 * @returns JSON confirmation result or an error.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const { id } = await ctx.params;
    return Response.json(await confirmDocument(id, await parseBody(req, Body)));
  } catch (err) {
    return errorResponse(err);
  }
}
