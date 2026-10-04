/** @file Patient call workspace reads and explicit mutations; real contact occurs only through an approved start. */
import { z } from "zod";
import {
  CallOutcomeSchema,
  CallReviewSchema,
} from "@/lib/calls/workspace-types";
import {
  answerCallDecision,
  changeCall,
  loadCallWorkspace,
  prepareCall,
  refreshCall,
  saveCallOutcome,
  startCall,
} from "@/lib/calls/workspace";
import { errorResponse, parseBody } from "@/lib/http";

/** Strict action bodies reject unknown controls, arbitrary call SIDs and implied approvals. */
const Body = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("prepare"),
      review: CallReviewSchema,
      mode: z.enum(["live", "rehearsal"]),
      approve: z.literal(true),
    })
    .strict(),
  z
    .object({
      action: z.enum(["start", "refresh", "end", "takeover", "rehearsal_next"]),
      sessionId: z.string().min(1),
    })
    .strict(),
  z
    .object({
      action: z.literal("decision"),
      sessionId: z.string().min(1),
      decisionId: z.string().min(1),
      resolution: z.enum(["ask_written", "decline", "takeover"]),
    })
    .strict(),
  z
    .object({ action: z.literal("outcome"), outcome: CallOutcomeSchema })
    .strict(),
]);

/** Returns saved sessions/configuration; a read never starts a call or refreshes provider state. */
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    return Response.json(await loadCallWorkspace((await ctx.params).id), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return errorResponse(error);
  }
}

/** Runs exactly the requested patient control and returns the case-bound session snapshot. */
export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { id } = await ctx.params;
    const body = await parseBody(req, Body);
    const session =
      body.action === "prepare"
        ? await prepareCall(id, body.review, body.mode)
        : body.action === "decision"
          ? await answerCallDecision(
              id,
              body.sessionId,
              body.decisionId,
              body.resolution,
            )
          : body.action === "outcome"
            ? await saveCallOutcome(id, body.outcome)
            : body.action === "start"
              ? await startCall(id, body.sessionId)
              : body.action === "refresh"
                ? await refreshCall(id, body.sessionId)
                : await changeCall(id, body.sessionId, body.action);
    return Response.json(session, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
