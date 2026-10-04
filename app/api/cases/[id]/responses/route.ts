/**
 * @file POST /api/cases/[id]/responses: record a billing-office response from the operator console
 * (SPEC.md §3.5, §6 MVP 2). **Simulated**: a teammate plays the billing office during the demo.
 *
 * Body: a `CounterpartyResponse` (one structured answer per finding) plus optional `attachSample`
 * (a correspondence sample to attach and cite). Free text is stored verbatim and never parsed.
 */
import { z } from "zod";
import { CORRESPONDENCE_SAMPLES, CounterpartyResponseSchema, recordResponse } from "@/lib/cases/caseflow";
import { errorResponse, parseBody } from "@/lib/http";

/** Request body: the response plus an optional sample to attach. */
const Body = CounterpartyResponseSchema.extend({
  attachSample: z.string().refine((s) => s in CORRESPONDENCE_SAMPLES, "unknown sample").optional(),
});

/**
 * Records the response and returns the new case state.
 *
 * @param req - Request with the JSON body.
 * @param ctx - Route context with the async `params`.
 * @returns JSON `CaseState`, or an error.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const { id } = await ctx.params;
    const body = await parseBody(req, Body);
    return Response.json(await recordResponse(id, body), { headers: { "Cache-Control": "private, no-store" } });
  } catch (err) {
    return errorResponse(err);
  }
}
