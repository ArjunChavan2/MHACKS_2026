/**
 * @file Outbound calls through Twilio with an ElevenLabs voice agent (SPEC.md §4.9, §6 MVP 4).
 *
 * Trial-compatible path (Twilio trials reject ElevenLabs' one-step outbound API and inline TwiML):
 * we create a plain Twilio call whose `Url` points at our `/api/calls/twiml` route. When Twilio
 * fetches it, the route verifies Twilio's signature and returns the TwiML from ElevenLabs'
 * "register call", which streams the call audio to the agent. Server-only; credentials from env.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

/** Thrown when a call can't be configured or placed; the message is safe to show. */
export class CallError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "CallError";
  }
}

/** Env needed by the TwiML route (runs on the deployed app when Twilio fetches it). */
const AgentEnv = z.object({
  TWILIO_PHONE_NUMBER: z.string().regex(/^\+\d{10,15}$/),
  TWILIO_AUTH_TOKEN: z.string().min(1),
  ELEVENLABS_API_KEY: z.string().min(1),
  ELEVENLABS_AGENT_ID: z.string().startsWith("agent_"),
});

/** Env needed to place a call. */
const CallEnv = z.object({
  APP_URL: z.string().url(),
  TWILIO_ACCOUNT_SID: z.string().startsWith("AC"),
  TWILIO_API_KEY_SID: z.string().startsWith("SK"),
  TWILIO_API_KEY_SECRET: z.string().min(1),
  TWILIO_PHONE_NUMBER: z.string().regex(/^\+\d{10,15}$/),
  ELEVENLABS_API_KEY: z.string().min(1),
  ELEVENLABS_AGENT_ID: z.string().startsWith("agent_"),
});

/** Validated call configuration. */
export type CallConfig = z.infer<typeof CallEnv>;

/** Validated configuration for the TwiML route. */
export type AgentConfig = z.infer<typeof AgentEnv>;

/** Path of our TwiML route; Twilio is given `${APP_URL}${TWIML_PATH}`. */
export const TWIML_PATH = "/api/calls/twiml";

/**
 * Reads and validates the call configuration from env.
 *
 * @returns The configuration.
 * @throws {CallError} Naming the missing or malformed variables (never their values).
 */
export function callConfig(): CallConfig {
  const r = CallEnv.safeParse(process.env);
  if (!r.success)
    throw new CallError(
      `Call setup incomplete: ${r.error.issues.map((i) => i.path.join(".")).join(", ")}`,
    );
  return r.data;
}

/**
 * Reads and validates the TwiML route's configuration from env.
 *
 * @returns The configuration.
 * @throws {CallError} Naming the missing or malformed variables (never their values).
 */
export function agentConfig(): AgentConfig {
  const r = AgentEnv.safeParse(process.env);
  if (!r.success)
    throw new CallError(
      `Call setup incomplete: ${r.error.issues.map((i) => i.path.join(".")).join(", ")}`,
    );
  return r.data;
}

/**
 * Checks Twilio's request signature (X-Twilio-Signature): base64 HMAC-SHA1, keyed with the Auth
 * Token, of the full URL followed by every POST parameter name and value sorted by name.
 *
 * Pure apart from hashing.
 *
 * @param authToken - Twilio Auth Token.
 * @param url - The exact URL Twilio requested (as given to Twilio, including any query string).
 * @param params - POST form parameters.
 * @param signature - Value of the X-Twilio-Signature header.
 * @returns True when the signature matches.
 */
export function validTwilioSignature(
  authToken: string,
  url: string,
  params: Record<string, string>,
  signature: string | null,
): boolean {
  if (!signature) return false;
  const data =
    url +
    Object.keys(params)
      .sort()
      .map((k) => k + params[k])
      .join("");
  const expected = createHmac("sha1", authToken)
    .update(data, "utf8")
    .digest("base64");
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Timeout for each provider request. */
const REQUEST_TIMEOUT_MS = 20_000;

/**
 * Asks ElevenLabs to register an outbound call and returns the TwiML that connects it to the agent.
 *
 * @param cfg - Call configuration.
 * @param to - Number being called (E.164).
 * @param dynamicVariables - Values the agent's prompt can reference (e.g. account number); written by code.
 * @returns TwiML XML.
 * @throws {CallError} When ElevenLabs refuses or returns no TwiML.
 */
export async function registerAgentCall(
  cfg: Pick<
    AgentConfig,
    "ELEVENLABS_API_KEY" | "ELEVENLABS_AGENT_ID" | "TWILIO_PHONE_NUMBER"
  >,
  to: string,
  dynamicVariables: Record<string, string | number> = {},
): Promise<string> {
  const res = await fetch(
    "https://api.elevenlabs.io/v1/convai/twilio/register-call",
    {
      method: "POST",
      headers: {
        "xi-api-key": cfg.ELEVENLABS_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        agent_id: cfg.ELEVENLABS_AGENT_ID,
        from_number: cfg.TWILIO_PHONE_NUMBER,
        to_number: to,
        direction: "outbound",
        conversation_initiation_client_data: {
          dynamic_variables: dynamicVariables,
        },
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    },
  );
  const text = await res.text();
  if (!res.ok)
    throw new CallError(
      `ElevenLabs refused the call (HTTP ${res.status}): ${text.slice(0, 200)}`,
      res.status,
    );
  // The endpoint returns TwiML, either raw or as a JSON string.
  let twiml = text.trim();
  if (twiml.startsWith('"')) twiml = JSON.parse(twiml) as string;
  if (!twiml.includes("<Response"))
    throw new CallError("ElevenLabs returned no call instructions.");
  return twiml;
}

/** What Twilio reports about a call. */
export interface CallStatus {
  sid: string;
  /** queued, ringing, in-progress, completed, busy, failed, no-answer, canceled. */
  status: string;
  /** Seconds, once completed. */
  duration: number | null;
}

/**
 * Sends one authenticated request to Twilio's REST API.
 *
 * @param cfg - Call configuration (API key auth).
 * @param path - Path under the account, e.g. "/Calls.json".
 * @param form - Form fields for a POST, or undefined for a GET.
 * @returns Parsed JSON.
 * @throws {CallError} With Twilio's message on failure.
 */
async function twilio(
  cfg: CallConfig,
  path: string,
  form?: Record<string, string>,
): Promise<Record<string, unknown>> {
  const auth = Buffer.from(
    `${cfg.TWILIO_API_KEY_SID}:${cfg.TWILIO_API_KEY_SECRET}`,
  ).toString("base64");
  const res = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${cfg.TWILIO_ACCOUNT_SID}${path}`,
    {
      method: form ? "POST" : "GET",
      headers: {
        Authorization: `Basic ${auth}`,
        ...(form
          ? { "Content-Type": "application/x-www-form-urlencoded" }
          : {}),
      },
      body: form ? new URLSearchParams(form) : undefined,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    },
  );
  const data = (await res.json()) as Record<string, unknown>;
  if (!res.ok)
    throw new CallError(
      `Twilio refused (HTTP ${res.status}, code ${String(data.code)}): ${String(data.message)}`,
      res.status,
    );
  return data;
}

/**
 * Places an outbound call from our Twilio number with the agent on the line.
 *
 * Side effects: a real phone call (uses Twilio and ElevenLabs credit). Callers must have the
 * patient's approval first (SPEC.md §4.7); this function does not check case state.
 *
 * @param to - Number to call (E.164). On a Twilio trial it must be a verified recipient with the
 *   trial number assigned to it.
 * @param dynamicVariables - Values for the agent's prompt.
 * @returns The new call's status.
 * @throws {CallError} When configuration is missing or a provider refuses.
 */
export async function placeAgentCall(
  to: string,
  dynamicVariables: Record<string, string | number> = {},
): Promise<CallStatus> {
  const cfg = callConfig();
  if (!/^\+\d{10,15}$/.test(to))
    throw new CallError("The number to call must be in +1XXXXXXXXXX format.");
  // Dynamic variables travel in the TwiML URL's query string (signed by Twilio when it fetches it).
  const query = new URLSearchParams(
    Object.entries(dynamicVariables).map(([k, v]) => [k, String(v)]),
  ).toString();
  const url = `${cfg.APP_URL.replace(/\/$/, "")}${TWIML_PATH}${query ? `?${query}` : ""}`;
  const call = await twilio(cfg, "/Calls.json", {
    To: to,
    From: cfg.TWILIO_PHONE_NUMBER,
    Url: url,
  });
  return { sid: String(call.sid), status: String(call.status), duration: null };
}

/**
 * Reads a call's current status.
 *
 * @param sid - Twilio call SID.
 * @returns Status and duration.
 */
export async function getCallStatus(sid: string): Promise<CallStatus> {
  const c = await twilio(callConfig(), `/Calls/${sid}.json`);
  return {
    sid,
    status: String(c.status),
    duration: c.duration ? Number(c.duration) : null,
  };
}

/**
 * Ends a known call, or replaces its agent stream with a direct patient dial after explicit takeover.
 * @param sid - Validated SID owned by the case's call session.
 * @param patientPhone - Approved E.164 takeover number; absent means end/cancel the call.
 * @returns Provider status. Transfer is requested, not claimed successful until provider status confirms completion.
 * Side effects: modifies an actual Twilio call; never called by polling or rehearsal.
 */
export async function controlCall(
  sid: string,
  patientPhone?: string,
): Promise<CallStatus> {
  if (!/^CA[0-9a-f]{32}$/i.test(sid))
    throw new CallError("Invalid call reference.");
  if (patientPhone && !/^\+\d{10,15}$/.test(patientPhone))
    throw new CallError("Invalid patient phone number.");
  const cfg = callConfig();
  const status = await getCallStatus(sid);
  const form: Record<string, string> = patientPhone
    ? {
        Twiml: `<Response><Say>The patient will take over now.</Say><Dial timeout="20"><Number>${patientPhone}</Number></Dial><Hangup/></Response>`,
      }
    : {
        Status: ["queued", "ringing"].includes(status.status)
          ? "canceled"
          : "completed",
      };
  const c = await twilio(cfg, `/Calls/${sid}.json`, form);
  return {
    sid,
    status: String(c.status),
    duration: c.duration ? Number(c.duration) : null,
  };
}
