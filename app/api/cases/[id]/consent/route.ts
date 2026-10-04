/**
 * @file POST /api/cases/[id]/consent: the patient types the consent phrase on the case screen (demo
 * stand-in for the iMessage reply). Recorded only when the text is the exact phrase.
 */
import { z } from "zod";
import { CONSENT_PHRASE, recordConsent } from "@/lib/cases/consent";
import { errorResponse, parseBody } from "@/lib/http";
import { BadRequestError } from "@/lib/cases/service";
import { getStore } from "@/lib/cases/store";

/** Request body. */
const Body = z.object({ text: z.string().min(1).max(200) });

/**
 * Records consent.
 *
 * @param req - Request with `{ text }`.
 * @param ctx - Route context with the async `params`.
 * @returns `{ ok: true }`, or 400 when the phrase doesn't match.
 */
export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { id } = await ctx.params;
    const { text } = await parseBody(req, Body);
    if (!(await getStore().getCase(id)))
      throw new BadRequestError("Unknown case");
    if (!(await recordConsent(id, text, "web")))
      throw new BadRequestError(
        `Consent was not recorded. The request may have expired or contact is on hold. For an active request, type exactly: ${CONSENT_PHRASE}`,
      );
    return Response.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
