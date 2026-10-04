/**
 * @file POST /api/cases/[id]/actions: run a case action (SPEC.md §3.2–3.3, §4.7, MVP 2).
 *
 * Body `{ actionId, target?, approve?, sentAt? }`. `record_letter_sent` records a patient-reported
 * manual send date without sending anything or authorizing contact. Other Actions that contact someone (send the dispute, request a
 * document, follow up) need `approve: true`, which is recorded as the patient's approval before the
 * action runs. Anything not in the case's allowed actions is refused with 409. Nothing is sent for
 * real: sends are recorded as "patient portal (simulated)".
 */
import { z } from "zod";
import { runCaseAction } from "@/lib/cases/caseflow";
import { errorResponse, parseBody } from "@/lib/http";

/** Request body. */
const Body = z.object({
  actionId: z.enum([
    "record_letter_sent",
    "send_dispute",
    "request_document",
    "request_revised_statement",
    "follow_up",
    "patient_takes_over",
  ]),
  target: z.string().min(1).optional(),
  approve: z.boolean().optional(),
  sentAt: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});

/**
 * Runs the action and returns the new case state.
 *
 * @param req - Request with the JSON body.
 * @param ctx - Route context with the async `params`.
 * @returns JSON `CaseState`, or an error.
 */
export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { id } = await ctx.params;
    const body = await parseBody(req, Body);
    return Response.json(await runCaseAction(id, body), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (err) {
    return errorResponse(err);
  }
}
