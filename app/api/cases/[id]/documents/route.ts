/** @file Binds an ingested document to its case/task without bypassing confirmation (SPEC.md §3.6). */
import { z } from "zod";
import { attachCaseDocument } from "@/lib/cases/attachments";
import { loadCase } from "@/lib/cases/service";
import { errorResponse, parseBody } from "@/lib/http";

/** Strict association request; no client-supplied finding or verification results. */
const Body = z
  .object({
    /** Incoming document already stored on this case. */
    documentId: z.string().min(1),
    /** Optional pending paperwork task on the same case. */
    taskId: z.string().min(1).optional(),
  })
  .strict();

/**
 * Associates a document and resumes checks only after its values are confirmed.
 * @param req - JSON document/task identifiers.
 * @param ctx - Async case route parameters.
 * @returns Refreshed case view or a visible refusal. Side effects: stores association/check events.
 */
export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { id } = await ctx.params;
    const body = await parseBody(req, Body);
    await attachCaseDocument(id, body.documentId, body.taskId);
    return Response.json(await loadCase(id), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (err) {
    return errorResponse(err);
  }
}
