/**
 * @file GET /api/cases/[id]/imessage (MVP 3): the case screen's iMessage panel. Returns the case's
 * link code (created on first request), whether a phone is linked, and the number to text.
 *
 * Like `GET /api/cases/[id]`, the unguessable case ID is the only key until real login exists
 * (SPEC.md §12). Linked handles are never returned.
 */
import { errorResponse } from "@/lib/http";
import { imessageStatus } from "@/lib/messaging/service";

/**
 * Returns the panel state.
 *
 * @param _req - Unused request.
 * @param ctx - Route context with the async `params`.
 * @returns JSON `{ code, linked, photonNumber }`, or 404.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const { id } = await ctx.params;
    const status = await imessageStatus(id);
    if (!status) return Response.json({ error: "not_found" }, { status: 404 });
    return Response.json(status, { headers: { "Cache-Control": "private, no-store" } });
  } catch (err) {
    return errorResponse(err);
  }
}
