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
 * The origin used in case links sent by text: `PUBLIC_APP_URL` if set (the patient-facing domain,
 * e.g. https://billless.tech), else `APP_URL` (which the call code also uses for Twilio callbacks),
 * else the request's own origin (whatever host the worker called).
 *
 * @param req - Incoming request.
 * @returns e.g. "https://billless.tech", without a trailing slash.
 */
export function publicOrigin(req: Request): string {
  const configured = [process.env.PUBLIC_APP_URL, process.env.APP_URL].map((v) => v?.trim().replace(/\/+$/, "")).find(Boolean);
  return configured || new URL(req.url).origin;
}
