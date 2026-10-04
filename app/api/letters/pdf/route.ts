/**
 * @file POST /api/letters/pdf: render a finished draft as a PDF download (SPEC.md §4.5).
 *
 * The draft text was produced server-side by `/api/letters` or `/api/requests/itemized`; this route
 * only lays it out.
 */
import { z } from "zod";
import { renderDraftPdf } from "@/lib/draft/pdf";
import { errorResponse, parseBody } from "@/lib/http";

/** Request body: a draft as returned by the drafting routes. */
const Body = z.object({
  draft: z.object({
    kind: z.enum(["dispute_letter", "itemized_bill_request", "appeal_letter", "documentation_request"]),
    subject: z.string(),
    paragraphs: z.array(z.object({ text: z.string(), sources: z.array(z.unknown()) })).min(1),
    author: z.enum(["llm", "template"]),
  }),
});

/**
 * Renders the PDF.
 *
 * @param req - JSON `{ draft }`.
 * @returns The PDF as an attachment, or an error.
 */
export async function POST(req: Request): Promise<Response> {
  try {
    const { draft } = await parseBody(req, Body);
    const date = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
    const pdf = await renderDraftPdf(draft as never, date);
    const name = `${draft.kind.replaceAll("_", "-")}.pdf`;
    return new Response(new Uint8Array(pdf), {
      headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${name}"`, "Cache-Control": "no-store" },
    });
  } catch (err) {
    return errorResponse(err);
  }
}
