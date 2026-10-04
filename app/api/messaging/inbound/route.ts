/**
 * @file POST /api/messaging/inbound (worker only, MVP 3): one text from the patient's iMessage in,
 * the reply out. Always answers with a reply so the patient is never left without one; failures
 * become a short apology with no details.
 */
import { z } from "zod";
import { parseBody } from "@/lib/http";
import { checkWorkerAuth, publicOrigin } from "@/lib/messaging/auth";
import { handleInbound } from "@/lib/messaging/service";

/** Body sent by the worker. */
const InboundSchema = z.object({ handle: z.string().trim().min(3).max(320), text: z.string().max(2000) });

/**
 * Handles an incoming text.
 *
 * @param req - Request with `{ handle, text }` and the worker's bearer token.
 * @returns JSON `{ reply }`, or 400/401/503.
 */
export async function POST(req: Request): Promise<Response> {
  const denied = checkWorkerAuth(req);
  if (denied) return denied;
  let body: z.infer<typeof InboundSchema>;
  try {
    body = await parseBody(req, InboundSchema);
  } catch (err) {
    return Response.json({ error: "bad_request", message: err instanceof Error ? err.message : "Bad request" }, { status: 400 });
  }
  try {
    return Response.json({ reply: await handleInbound(body.handle, body.text, publicOrigin(req)) });
  } catch (err) {
    console.error("messaging inbound failed", err instanceof Error ? err.message : err);
    return Response.json({ reply: "Something went wrong on our side. Nothing was sent or approved. Try again in a minute." });
  }
}
