/**
 * @file GET /api/cases/[id]: load a saved case from the database so the app can resume it after a
 * reload (SPEC.md §4.6).
 *
 * Returns the patient's own documents, findings, and latest draft, with no-store caching.
 * *Open:* add authentication when real login exists (SPEC.md §12); until then the unguessable case
 * ID is the only key, as for `/api/documents/[id]/file`.
 */
import { loadCase } from "@/lib/cases/service";
import { errorResponse } from "@/lib/http";

/**
 * Returns the case.
 *
 * @param _req - Unused request.
 * @param ctx - Route context with the async `params`.
 * @returns JSON `CaseView`, or 404.
 */
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { id } = await ctx.params;
    const view = await loadCase(id);
    if (!view) return Response.json({ error: "not_found" }, { status: 404 });
    return Response.json(view, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (err) {
    return errorResponse(err);
  }
}
