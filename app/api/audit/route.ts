/**
 * @file POST /api/audit: run the deterministic audit on confirmed documents (SPEC.md §4.3).
 */
import { z } from "zod";
import { errorResponse, parseBody } from "@/lib/http";
import { auditCase } from "@/lib/cases/service";

/** Request body. */
const Body = z.object({ caseId: z.string(), billId: z.string(), eobId: z.string().nullable() });

/**
 * Runs the audit.
 *
 * @param req - JSON `{ caseId, billId, eobId }`.
 * @returns JSON findings, verdict, and providers searched, or an error.
 */
export async function POST(req: Request): Promise<Response> {
  try {
    const { caseId, billId, eobId } = await parseBody(req, Body);
    return Response.json(await auditCase(caseId, billId, eobId));
  } catch (err) {
    return errorResponse(err);
  }
}
