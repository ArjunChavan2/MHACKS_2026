/**
 * @file POST /api/cases/[id]/calls: save a finished call's transcript to the case (MVP 4).
 *
 * Body `{ conversationId? }`; without it, the agent's most recent finished call is saved. The
 * transcript is stored exactly as ElevenLabs recorded it and shown on the case screen.
 */
import { z } from "zod";
import { addCallToCase } from "@/lib/cases/caseflow";
import { errorResponse, parseBody } from "@/lib/http";

/** Request body. */
const Body = z.object({ conversationId: z.string().min(1).max(100).optional() });

/**
 * Saves the call and returns the new case state.
 *
 * @param req - Request with the JSON body.
 * @param ctx - Route context with the async `params`.
 * @returns JSON `CaseState`, or an error.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const { id } = await ctx.params;
    const { conversationId } = await parseBody(req, Body);
    return Response.json(await addCallToCase(id, conversationId), { headers: { "Cache-Control": "private, no-store" } });
  } catch (err) {
    return errorResponse(err);
  }
}
