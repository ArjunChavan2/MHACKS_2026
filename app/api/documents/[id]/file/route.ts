/**
 * @file GET /api/documents/[id]/file: stream the original upload for the confirm-screen preview.
 *
 * Files are stored privately; this is the only way to read one, by document ID, with no-store
 * caching. *Open:* add authentication when real login exists (SPEC.md §12).
 */
import { getStore } from "@/lib/cases/store";
import { errorResponse } from "@/lib/http";

/**
 * Returns the original file.
 *
 * @param _req - Unused request.
 * @param ctx - Route context with the async `params`.
 * @returns The file bytes, or 404.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const { id } = await ctx.params;
    const store = getStore();
    const doc = await store.getDocument(id);
    const file = doc?.storageKey ? await store.getFile(doc.storageKey) : null;
    if (!file) return Response.json({ error: "not_found" }, { status: 404 });
    return new Response(Buffer.from(file.bytes), {
      headers: { "Content-Type": file.mimeType, "Cache-Control": "private, no-store", "Content-Disposition": "inline" },
    });
  } catch (err) {
    return errorResponse(err);
  }
}
