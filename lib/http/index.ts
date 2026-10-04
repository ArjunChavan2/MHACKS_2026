/**
 * @file Shared helpers for API route handlers: input validation and error mapping (SPEC.md §5.4).
 */
import { z } from "zod";
import { ActionRefusedError } from "@/lib/cases/caseflow";
import { CaseRuleError } from "@/lib/cases/responses";
import { BadRequestError } from "@/lib/cases/service";
import { LlmBusyError, LlmInvalidOutputError, LlmUnavailableError } from "@/lib/llm";

/**
 * Parses a JSON request body with a zod schema.
 *
 * @param req - Incoming request.
 * @param schema - Expected body shape.
 * @returns The validated body.
 * @throws {BadRequestError} When the body is not valid JSON or doesn't match.
 */
export async function parseBody<T>(req: Request, schema: z.ZodType<T>): Promise<T> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw new BadRequestError("Request body must be JSON");
  }
  const r = schema.safeParse(body);
  if (!r.success) throw new BadRequestError(r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  return r.data;
}

/**
 * Maps an error to a JSON response. Known errors get clear messages; anything else is a 500 that
 * never looks like success (SPEC.md §5.4).
 *
 * @param err - Thrown value.
 * @returns JSON error response.
 */
export function errorResponse(err: unknown): Response {
  if (err instanceof BadRequestError) return Response.json({ error: "bad_request", message: err.message }, { status: 400 });
  if (err instanceof CaseRuleError) return Response.json({ error: "bad_request", message: err.message }, { status: 400 });
  if (err instanceof ActionRefusedError) return Response.json({ error: "not_allowed", message: err.message }, { status: 409 });
  if (err instanceof LlmUnavailableError) {
    return Response.json(
      { error: "no_ai", message: `AI reading isn't configured (${err.envVar}). Use a sample document instead.` },
      { status: 503 },
    );
  }
  if (err instanceof LlmBusyError) {
    return Response.json(
      { error: "ai_busy", message: "The AI service is busy right now. Try again in a minute, or use a sample document." },
      { status: 503 },
    );
  }
  if (err instanceof LlmInvalidOutputError) {
    return Response.json({ error: "ai_invalid", message: "The document couldn't be read reliably. Try a clearer photo or the PDF." }, { status: 502 });
  }
  console.error(err);
  return Response.json({ error: "server_error", message: "Something went wrong. Nothing was saved as complete." }, { status: 500 });
}
