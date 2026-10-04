/** @file Reopens an unsent bill review for patient corrections; server invalidates old findings and drafts. */
import { reopenReview } from "@/lib/cases/service";
import { errorResponse } from "@/lib/http";

/**
 * Reopens the existing case without contacting a counterparty.
 * @param _req - POST request; no patient facts are accepted in this operation.
 * @param ctx - Case identifier resolved by Next.js.
 * @returns The refreshed case view or a visible refusal for a case already acted on.
 */
export async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { id } = await ctx.params;
    return Response.json(await reopenReview(id), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
