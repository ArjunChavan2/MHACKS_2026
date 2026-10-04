/**
 * @file Call transcripts from ElevenLabs, saved to a case (SPEC.md §4.6 "call transcripts", MVP 4).
 *
 * Transcripts are copied as ElevenLabs recorded them (speaker, text, time); nothing is summarized
 * or rewritten. Server-only; uses `ELEVENLABS_API_KEY` and `ELEVENLABS_AGENT_ID`.
 */
import { z } from "zod";
import { CallError } from "./index";

/** One turn of a call, as recorded. */
export interface CallTurn {
  /** "agent" (our assistant) or "user" (the person on the phone). */
  role: "agent" | "user";
  message: string;
  /** Seconds from the start of the call. */
  atSecs: number;
}

/** A finished call saved on a case. */
export interface CallRecord {
  conversationId: string;
  /** ISO timestamp the call started. */
  startedAt: string;
  durationSecs: number;
  /** How the call ended, as ElevenLabs reports it (e.g. "end_call tool was called."). */
  endedBy: string | null;
  transcript: CallTurn[];
}

/** Plain descriptions of the agent's call actions (shown in place of tool calls). */
const ACTIONS: Record<string, string> = {
  transfer_to_number: "(Transferred the call to the patient)",
  end_call: "(Ended the call)",
};

/** ElevenLabs conversation, as far as we read it. */
const ConversationSchema = z.object({
  conversation_id: z.string(),
  status: z.string(),
  metadata: z
    .object({ start_time_unix_secs: z.number().optional(), call_duration_secs: z.number().optional(), termination_reason: z.string().nullish() })
    .passthrough()
    .default({}),
  transcript: z
    .array(
      z
        .object({
          role: z.string(),
          message: z.string().nullish(),
          time_in_call_secs: z.number().nullish(),
          tool_calls: z.array(z.object({ tool_name: z.string().nullish() }).passthrough()).nullish(),
        })
        .passthrough(),
    )
    .default([]),
});

/** Conversation list item. */
const ListSchema = z.object({
  conversations: z.array(z.object({ conversation_id: z.string(), status: z.string(), start_time_unix_secs: z.number().optional() }).passthrough()),
});

/**
 * Reads the ElevenLabs settings.
 *
 * @returns API key and agent ID.
 * @throws {CallError} When either is missing.
 */
function settings(): { key: string; agentId: string } {
  const key = process.env.ELEVENLABS_API_KEY;
  const agentId = process.env.ELEVENLABS_AGENT_ID;
  if (!key || !agentId) throw new CallError("Call history isn't configured (ELEVENLABS_API_KEY, ELEVENLABS_AGENT_ID).");
  return { key, agentId };
}

/**
 * GETs an ElevenLabs API path.
 *
 * @param path - Path under https://api.elevenlabs.io.
 * @param key - API key.
 * @returns Parsed JSON.
 * @throws {CallError} On a non-2xx response.
 */
async function get(path: string, key: string): Promise<unknown> {
  const res = await fetch(`https://api.elevenlabs.io${path}`, { headers: { "xi-api-key": key }, signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new CallError(`ElevenLabs returned HTTP ${res.status} for call history.`, res.status);
  return res.json();
}

/**
 * Fetches one finished conversation as a call record.
 *
 * @param conversationId - ElevenLabs conversation ID.
 * @returns The call record.
 * @throws {CallError} When it can't be fetched or the call hasn't finished yet.
 */
export async function fetchCall(conversationId: string): Promise<CallRecord> {
  const { key } = settings();
  const c = ConversationSchema.parse(await get(`/v1/convai/conversations/${encodeURIComponent(conversationId)}`, key));
  if (c.status !== "done") throw new CallError("That call hasn't finished yet. Try again after it ends.");
  const start = c.metadata.start_time_unix_secs;
  return {
    conversationId: c.conversation_id,
    startedAt: start ? new Date(start * 1000).toISOString() : new Date().toISOString(),
    durationSecs: c.metadata.call_duration_secs ?? 0,
    endedBy: c.metadata.termination_reason ?? null,
    transcript: c.transcript
      .filter((t) => t.role === "agent" || t.role === "user")
      .map((t) => {
        const action = (t.tool_calls ?? []).map((tc) => ACTIONS[tc.tool_name ?? ""]).find(Boolean);
        const text = (t.message ?? "").trim();
        return { role: t.role as "agent" | "user", message: text || action || "", atSecs: t.time_in_call_secs ?? 0 };
      })
      .filter((t) => t.message),
  };
}

/**
 * Finds the most recent finished call of our agent.
 *
 * @returns Its conversation ID.
 * @throws {CallError} When there is none.
 */
export async function latestFinishedCallId(): Promise<string> {
  const { key, agentId } = settings();
  const list = ListSchema.parse(await get(`/v1/convai/conversations?page_size=10&agent_id=${encodeURIComponent(agentId)}`, key));
  const done = list.conversations.filter((c) => c.status === "done").sort((a, b) => (b.start_time_unix_secs ?? 0) - (a.start_time_unix_secs ?? 0));
  if (!done.length) throw new CallError("No finished calls yet.");
  return done[0].conversation_id;
}
