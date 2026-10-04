/** @file Persists patient issue selection without changing deterministic findings or sending anything. */
import { z } from "zod";
import { setFindingExcluded } from "@/lib/cases/service";
import { errorResponse, parseBody } from "@/lib/http";

/** Only a server finding ID and the patient's selection are accepted. */
const Body = z.object({ findingId: z.string().min(1), excluded: z.boolean() });

/**
 * Excludes or restores an issue for an unsent review.
 * @param req - Patient selection as JSON.
 * @param ctx - Case identifier resolved by Next.js.
 * @returns Updated case or a visible validation error.
 */
export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { id } = await ctx.params;
    const { findingId, excluded } = await parseBody(req, Body);
    return Response.json(await setFindingExcluded(id, findingId, excluded), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
