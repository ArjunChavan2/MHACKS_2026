/**
 * @file POST /api/messaging/ack (worker only, MVP 3): the worker reports an outbox message as sent.
 * Idempotent.
 */
import { z } from "zod";
import { errorResponse, parseBody } from "@/lib/http";
import { checkWorkerAuth } from "@/lib/messaging/auth";
import { ack } from "@/lib/messaging/service";

/** Body sent by the worker. */
const AckSchema = z.object({ messageId: z.string().min(1).max(100) });

/**
 * Marks a message sent.
 *
 * @param req - Request with `{ messageId }` and the worker's bearer token.
 * @returns JSON `{ ok: true }`, 404 for an unknown message, or 400/401/503.
 */
export async function POST(req: Request): Promise<Response> {
  const denied = checkWorkerAuth(req);
  if (denied) return denied;
  try {
    const { messageId } = await parseBody(req, AckSchema);
    return (await ack(messageId)) ? Response.json({ ok: true }) : Response.json({ error: "not_found" }, { status: 404 });
  } catch (err) {
    return errorResponse(err);
  }
}
