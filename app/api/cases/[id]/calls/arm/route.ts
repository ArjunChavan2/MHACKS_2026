/**
 * @file POST /api/cases/[id]/calls/arm: "Get Billy ready for a call" (MVP 4 demo). Inbound demo calls
 * carry no case ID, so the patient picks the case: the next call is briefed from the case that pressed
 * this last (`caseForLiveCall`), no matter who else is using the site.
 */
import { getStore } from "@/lib/cases/store";
import { BadRequestError } from "@/lib/cases/service";
import { errorResponse } from "@/lib/http";

/**
 * Marks this case as the one Billy's next call is about.
 *
 * @param _req - Request (no body).
 * @param ctx - Route params with the case ID.
 * @returns `{ armedAt }`.
 */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const { id } = await ctx.params;
    const store = getStore();
    if (!(await store.getCase(id))) throw new BadRequestError("Case not found");
    await store.addEvent(id, "call_armed", {});
    return Response.json({ armedAt: new Date().toISOString() }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (err) {
    return errorResponse(err);
  }
}
