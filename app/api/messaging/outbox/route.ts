/**
 * @file GET /api/messaging/outbox (worker only, MVP 3): updates the worker should text now, one per
 * linked phone. Computed on read from each linked case's state (`pendingOutbox`).
 */
import { errorResponse } from "@/lib/http";
import { checkWorkerAuth, publicOrigin } from "@/lib/messaging/auth";
import { pendingOutbox } from "@/lib/messaging/service";

/**
 * Lists pending messages.
 *
 * @param req - Request with the worker's bearer token.
 * @returns JSON `[{ messageId, handle, text }]`, or 401/503.
 */
export async function GET(req: Request): Promise<Response> {
  const denied = checkWorkerAuth(req);
  if (denied) return denied;
  try {
    return Response.json(await pendingOutbox(publicOrigin(req)), { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return errorResponse(err);
  }
}
