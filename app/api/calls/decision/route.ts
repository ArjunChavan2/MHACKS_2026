/** @file Authenticated ElevenLabs administrative offer tool; waits for patient review and declines on timeout. */
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { requestCallDecision, waitCallDecision } from "@/lib/calls/workspace";
import { errorResponse, parseBody } from "@/lib/http";

/** Provider serverless request budget accommodates the bounded forty-second patient response window. */
export const maxDuration = 60;
/** Exact case/session variables and the office statement transcribed verbatim; no model interpretation accepted. */
const Body = z
  .object({
    caseId: z.string().min(1),
    sessionId: z.string().min(1),
    statement: z.string().trim().min(1).max(2000),
  })
  .strict();

/** Requests an administrative choice. None of the possible results authorizes payment or acceptance of conditions. */
export async function POST(req: Request): Promise<Response> {
  const secret = process.env.MESSAGING_SECRET;
  const given = req.headers.get("x-billy-secret");
  if (
    !secret ||
    !given ||
    Buffer.byteLength(secret) !== Buffer.byteLength(given) ||
    !timingSafeEqual(Buffer.from(secret), Buffer.from(given))
  )
    return Response.json({ error: "unauthorized" }, { status: 401 });
  try {
    const body = await parseBody(req, Body);
    const decision = await requestCallDecision(
      body.caseId,
      body.sessionId,
      body.statement,
    );
    const resolution = await waitCallDecision(
      body.caseId,
      body.sessionId,
      decision.id,
    );
    return Response.json({
      resolution,
      agreementAuthorized: false,
      message:
        resolution === "ask_written"
          ? "The patient asks for written details. No offer or condition is accepted."
          : resolution === "takeover"
            ? "The patient wants to speak directly. Use the approved patient transfer number or arrange a callback; no agreement is accepted."
            : "No agreement is authorized. Decline the proposal and arrange a patient callback if needed.",
    });
  } catch (error) {
    return errorResponse(error);
  }
}
