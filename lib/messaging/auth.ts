/**
 * @file Shared-secret check for the worker-only messaging routes (`/api/messaging/*`, MVP 3).
 *
 * The Photon worker sends `Authorization: Bearer $MESSAGING_SECRET`. Without the env var the routes
 * are switched off (503) rather than open, so a deployment that never configured iMessage exposes
 * nothing.
 */
import { timingSafeEqual } from "node:crypto";

/**
 * Checks the worker's bearer token in constant time.
 *
 * @param req - Incoming request.
 * @returns `null` when authorized, otherwise the error response to return.
 */
export function checkWorkerAuth(req: Request): Response | null {
  const secret = process.env.MESSAGING_SECRET?.trim();
  if (!secret) return Response.json({ error: "not_configured", message: "iMessage isn't configured (MESSAGING_SECRET)." }, { status: 503 });
  const header = req.headers.get("authorization") ?? "";
  const given = Buffer.from(header.startsWith("Bearer ") ? header.slice(7).trim() : "");
  const want = Buffer.from(secret);
  if (given.length !== want.length || !timingSafeEqual(given, want)) return Response.json({ error: "unauthorized" }, { status: 401 });
  return null;
}

/**
 * The origin used in case links sent by text: `APP_URL` if set, else the request's own origin.
 *
 * @param req - Incoming request.
 * @returns e.g. "https://billless.tech".
 */
export function publicOrigin(req: Request): string {
  return process.env.APP_URL?.trim().replace(/\/+$/, "") || new URL(req.url).origin;
}
