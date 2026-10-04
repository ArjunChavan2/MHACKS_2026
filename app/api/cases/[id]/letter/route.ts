/** @file Saves patient wording while protecting server-held letter facts. */
import { z } from "zod";
import { editLetter, saveLetterRecipient } from "@/lib/cases/service";
import { errorResponse, parseBody } from "@/lib/http";

/** Bounded patient edits; document evidence and originals are never accepted from the client. */
const Body = z.object({
  expectedText: z.array(z.string()).min(1).max(100),
  edits: z
    .array(
      z.object({
        index: z.number().int().nonnegative(),
        text: z.string().trim().min(1).max(5000),
      }),
    )
    .max(100),
  personalNote: z.string().max(5000),
  reset: z.boolean(),
});

/** Saves or resets the current unsent letter and returns the updated case. */
export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { id } = await ctx.params;
    return Response.json(await editLetter(id, await parseBody(req, Body)), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return errorResponse(error);
  }
}

/** Only a single patient-entered address is allowed, preventing mail header injection. */
const Recipient = z.object({
  recipientEmail: z.union([z.string().trim().email().max(254), z.literal("")]),
});

/** Persists the recipient for manual email composition without sending correspondence. */
export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { id } = await ctx.params;
    const { recipientEmail } = await parseBody(req, Recipient);
    return Response.json(await saveLetterRecipient(id, recipientEmail), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
