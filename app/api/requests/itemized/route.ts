/**
 * @file POST /api/requests/itemized: draft an itemized-bill request from a balance statement
 * (SPEC.md §4.2 "I only have a balance statement").
 */
import { z } from "zod";
import { errorResponse, parseBody } from "@/lib/http";
import { draftItemizedRequest } from "@/lib/cases/service";

/** Request body. */
const Body = z.object({ documentId: z.string(), acknowledgeDocType: z.boolean().optional() });

/**
 * Drafts the request.
 *
 * @param req - JSON `{ documentId, acknowledgeDocType? }`.
 * @returns JSON `{ draft }` or an error.
 */
export async function POST(req: Request): Promise<Response> {
  try {
    const { documentId, acknowledgeDocType } = await parseBody(req, Body);
    return Response.json({ draft: await draftItemizedRequest(documentId, acknowledgeDocType) });
  } catch (err) {
    return errorResponse(err);
  }
}
