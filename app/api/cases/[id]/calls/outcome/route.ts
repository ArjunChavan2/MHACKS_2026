/**
 * @file POST /api/cases/[id]/calls/outcome: the patient confirms or rejects what Billy heard on a call
 * (the AI's reading of the call is only a proposal until confirmed). Body `{ conversationId, decision }`.
 */
import { z } from "zod";
import { decideCallOutcome } from "@/lib/cases/caseflow";
import { errorResponse, parseBody } from "@/lib/http";

/** Request body. */
const Body = z.object({ conversationId: z.string().min(1).max(100), decision: z.enum(["confirm", "reject"]) });

/**
 * Applies the decision and returns the new case state.
 *
 * @param req - Request with the JSON body.
 * @param ctx - Route context with the async `params`.
 * @returns JSON `CaseState`, or an error.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const { id } = await ctx.params;
    const { conversationId, decision } = await parseBody(req, Body);
    return Response.json(await decideCallOutcome(id, conversationId, decision), { headers: { "Cache-Control": "private, no-store" } });
  } catch (err) {
    return errorResponse(err);
  }
}
