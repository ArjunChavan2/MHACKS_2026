/**
 * @file Proves finished call transcripts are saved to a case exactly as recorded, once, and shown in
 * the case state (MVP 4 call history). ElevenLabs is stubbed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { addCallToCase } from "@/lib/cases/caseflow";
import { ingestSample, loadCase } from "@/lib/cases/service";
import { memoryStore, type CaseStore } from "@/lib/cases/store";

const g = globalThis as typeof globalThis & { __mhStore?: CaseStore };
const saved = { key: process.env.ELEVENLABS_API_KEY, agent: process.env.ELEVENLABS_AGENT_ID };

/** A finished ElevenLabs conversation. */
const DONE = {
  conversation_id: "conv_done",
  status: "done",
  metadata: { start_time_unix_secs: 1791107000, call_duration_secs: 75, termination_reason: "end_call tool was called." },
  transcript: [
    { role: "agent", message: "Hi, I'm calling on behalf of Priya Ramaswamy.", time_in_call_secs: 0 },
    { role: "user", message: "Billing office, how can I help?", time_in_call_secs: 4 },
    { role: "agent", message: "", time_in_call_secs: 70 },
    { role: "agent", message: "", time_in_call_secs: 72, tool_calls: [{ tool_name: "transfer_to_number" }] },
  ],
};

beforeEach(() => {
  g.__mhStore = memoryStore();
  process.env.ELEVENLABS_API_KEY = "test";
  process.env.ELEVENLABS_AGENT_ID = "agent_test";
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    if (url.includes("/conversations?")) {
      return new Response(JSON.stringify({ conversations: [{ conversation_id: "conv_live", status: "in-progress", start_time_unix_secs: 1791107100 }, { conversation_id: "conv_done", status: "done", start_time_unix_secs: 1791107000 }] }));
    }
    if (url.endsWith("/conv_done")) return new Response(JSON.stringify(DONE));
    if (url.endsWith("/conv_live")) return new Response(JSON.stringify({ ...DONE, conversation_id: "conv_live", status: "in-progress" }));
    return new Response("{}", { status: 404 });
  }));
});
afterEach(() => {
  vi.unstubAllGlobals();
  process.env.ELEVENLABS_API_KEY = saved.key;
  process.env.ELEVENLABS_AGENT_ID = saved.agent;
});

describe("call history", () => {
  /** Proves the latest finished call is saved verbatim (empty turns dropped) and appears on reload. */
  it("saves the latest finished call to the case", async () => {
    const { caseId } = await ingestSample(null, "sample-bill");
    const s = await addCallToCase(caseId);
    expect(s.calls).toHaveLength(1);
    expect(s.calls[0]).toMatchObject({ conversationId: "conv_done", durationSecs: 75, endedBy: "end_call tool was called." });
    expect(s.calls[0].transcript).toEqual([
      { role: "agent", message: "Hi, I'm calling on behalf of Priya Ramaswamy.", atSecs: 0 },
      { role: "user", message: "Billing office, how can I help?", atSecs: 4 },
      { role: "agent", message: "(Transferred the call to the patient)", atSecs: 72 },
    ]);
    expect((await loadCase(caseId))?.state.calls).toHaveLength(1);
  });
  /** Proves the same call can't be saved twice and an unfinished call is refused. */
  it("refuses duplicates and unfinished calls", async () => {
    const { caseId } = await ingestSample(null, "sample-bill");
    await addCallToCase(caseId);
    await expect(addCallToCase(caseId)).rejects.toThrow(/already saved/);
    await expect(addCallToCase(caseId, "conv_live")).rejects.toThrow(/hasn't finished/);
  });
});
