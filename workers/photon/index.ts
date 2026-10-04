/**
 * @file Photon Spectrum worker (SPEC.md §4.8, §6 MVP 3): moves text between iMessage and the app.
 * Transport only; every decision and every word of every reply is made by the app
 * (`/api/messaging/*`, `lib/messaging`). Runs on a laptop or a small always-on host, never on Vercel
 * (Spectrum keeps a long-lived stream open).
 *
 * Run: `npm run worker:photon` (iMessage via Photon), or
 * `npm run worker:photon -- --local <handle>` to type replies in the terminal as that handle, with no
 * Photon credentials (outbox messages are printed instead of sent).
 *
 * Env: `APP_URL` (which deployment to call), `MESSAGING_SECRET` (same value as the app), and for
 * iMessage `PHOTON_PROJECT_ID` + `PHOTON_PROJECT_SECRET`. Logs never include message bodies or full
 * handles (SPEC.md §2 rule 12; handles are personal data).
 */
import { createInterface } from "node:readline";
import { Spectrum } from "@spectrum-ts/core";
import { imessage } from "@spectrum-ts/imessage";

/** How often to ask the app for pending updates. */
const OUTBOX_POLL_MS = 3000;

/** Longest wait between reconnect attempts after the Photon stream fails. */
const MAX_BACKOFF_MS = 30_000;

/** A pending message from `GET /api/messaging/outbox`. */
interface OutboxItem {
  messageId: string;
  handle: string;
  text: string;
}

/** Sends one text to a handle. */
type SendFn = (handle: string, text: string) => Promise<void>;

/**
 * Reads a required env var or exits with a clear message.
 *
 * @param name - Variable name.
 * @returns Its trimmed value.
 */
function required(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) {
    console.error(`[photon] ${name} is not set. Add it to .env.local (see .env.example). The web app is unaffected.`);
    process.exit(1);
  }
  return v;
}

/**
 * Masks a handle for logs.
 *
 * @param handle - Phone number or email.
 * @returns e.g. "…23".
 */
function mask(handle: string): string {
  return `…${handle.slice(-2)}`;
}

/**
 * Calls a worker-only app route with the shared secret.
 *
 * @param path - e.g. "/api/messaging/outbox".
 * @param init - Fetch options (method, JSON body).
 * @returns Parsed JSON.
 * @throws {Error} On a non-2xx status.
 */
async function api<T>(path: string, init?: { method: "POST"; body: unknown }): Promise<T> {
  const res = await fetch(`${APP_URL}${path}`, {
    method: init?.method ?? "GET",
    headers: { Authorization: `Bearer ${SECRET}`, ...(init ? { "Content-Type": "application/json" } : {}) },
    ...(init ? { body: JSON.stringify(init.body) } : {}),
  });
  if (!res.ok) throw new Error(`${path} returned ${res.status}`);
  return (await res.json()) as T;
}

/**
 * Asks the app for the reply to one incoming text.
 *
 * @param handle - Sender handle.
 * @param text - Message text.
 * @returns The reply to send back.
 */
async function inbound(handle: string, text: string): Promise<string> {
  console.log(`[photon] in from ${mask(handle)} (${text.length} chars)`);
  const { reply } = await api<{ reply: string }>("/api/messaging/inbound", { method: "POST", body: { handle, text } });
  return reply;
}

/**
 * Starts polling the outbox: sends each pending update, then acknowledges it. Overlapping polls are
 * skipped; failures are logged and retried on the next poll (unacknowledged messages stay pending).
 *
 * @param send - How to deliver one text.
 * @returns A function that stops polling.
 */
function pollOutbox(send: SendFn): () => void {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const items = await api<OutboxItem[]>("/api/messaging/outbox");
      const byId = new Map<string, OutboxItem[]>();
      for (const it of items) byId.set(it.messageId, [...(byId.get(it.messageId) ?? []), it]);
      for (const [messageId, group] of byId) {
        for (const it of group) await send(it.handle, it.text);
        await api("/api/messaging/ack", { method: "POST", body: { messageId } });
        console.log(`[photon] sent update ${messageId} to ${group.length} phone(s)`);
      }
    } catch (err) {
      console.error(`[photon] outbox: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      running = false;
    }
  };
  const t = setInterval(tick, OUTBOX_POLL_MS);
  void tick();
  return () => clearInterval(t);
}

/**
 * Local mode: type messages as `handle`; replies and outbox updates are printed. No Photon needed.
 *
 * @param handle - The handle to pretend to be, e.g. "+15555550123".
 */
async function runLocal(handle: string): Promise<void> {
  console.log(`[photon] local mode as ${mask(handle)} → ${APP_URL}. Type a message (LINK <code>, STATUS, A, B, WHY, STOP).`);
  pollOutbox(async (to, text) => console.log(`\n[update to ${mask(to)}]\n${text}\n`));
  const rl = createInterface({ input: process.stdin });
  for await (const line of rl) {
    if (!line.trim()) continue;
    try {
      console.log(`\n${await inbound(handle, line)}\n`);
    } catch (err) {
      console.error(`[photon] inbound: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

/**
 * Connects to Photon once and serves until the stream ends or fails.
 *
 * @param projectId - Photon project ID.
 * @param projectSecret - Photon project secret.
 */
async function serveOnce(projectId: string, projectSecret: string): Promise<void> {
  const app = await Spectrum({ projectId, projectSecret, providers: [imessage.config()] });
  const im = imessage(app);
  console.log("[photon] connected to iMessage");
  const stop = pollOutbox(async (handle, text) => {
    const space = await im.space.create(handle);
    await space.send(text);
  });
  try {
    for await (const [space, message] of im.messages) {
      if (message.direction !== "inbound" || message.content.type !== "text" || !message.sender) continue;
      try {
        const reply = await inbound(message.sender.id, message.content.text);
        await space.send(reply);
      } catch (err) {
        console.error(`[photon] inbound: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  } finally {
    stop();
    await app.stop().catch(() => undefined);
  }
}

/**
 * iMessage mode: serves forever, reconnecting with backoff when the Photon stream fails.
 */
async function runPhoton(): Promise<void> {
  const projectId = required("PHOTON_PROJECT_ID");
  const projectSecret = required("PHOTON_PROJECT_SECRET");
  let backoff = 1000;
  for (;;) {
    const started = Date.now();
    try {
      await serveOnce(projectId, projectSecret);
      console.error("[photon] stream ended; reconnecting");
    } catch (err) {
      console.error(`[photon] stream failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    backoff = Date.now() - started > 60_000 ? 1000 : Math.min(backoff * 2, MAX_BACKOFF_MS);
    await new Promise((r) => setTimeout(r, backoff));
  }
}

/** Which deployment the worker calls. */
const APP_URL = required("APP_URL").replace(/\/+$/, "");
/** Shared secret for `/api/messaging/*`. */
const SECRET = required("MESSAGING_SECRET");

const localAt = process.argv.indexOf("--local");
if (localAt >= 0) {
  const handle = process.argv[localAt + 1];
  if (!handle) {
    console.error("[photon] usage: npm run worker:photon -- --local <handle>");
    process.exit(1);
  }
  void runLocal(handle);
} else {
  void runPhoton();
}
