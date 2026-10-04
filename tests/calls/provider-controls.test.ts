/** @file Provider contract regressions: scoped dynamic variables, cancel-vs-end controls and patient transfer. Fetch is mocked. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { controlCall, registerAgentCall } from "@/lib/calls";

/** Synthetic provider config; no credential used by these tests is real. */
function settings() {
  for (const [name, value] of Object.entries({
    APP_URL: "https://example.test",
    TWILIO_ACCOUNT_SID: "ACtest",
    TWILIO_API_KEY_SID: "SKtest",
    TWILIO_API_KEY_SECRET: "test",
    TWILIO_PHONE_NUMBER: "+15555550100",
    ELEVENLABS_API_KEY: "test",
    ELEVENLABS_AGENT_ID: "agent_test",
  }))
    vi.stubEnv(name, value);
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
describe("provider call controls", () => {
  /** The current ElevenLabs API receives approved variables under client initiation data rather than an ignored top-level field. */
  it("registers the approved brief in the correct provider payload", async () => {
    const fetcher = vi.fn(
      async () => new Response("<Response><Hangup/></Response>"),
    );
    vi.stubGlobal("fetch", fetcher);
    await registerAgentCall(
      {
        ELEVENLABS_API_KEY: "test",
        ELEVENLABS_AGENT_ID: "agent_test",
        TWILIO_PHONE_NUMBER: "+15555550100",
      },
      "+15555550101",
      { approved_brief: "Approved administrative facts only" },
    );
    const request = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(request[1].body))).toMatchObject({
      conversation_initiation_client_data: {
        dynamic_variables: {
          approved_brief: "Approved administrative facts only",
        },
      },
    });
    expect(JSON.parse(String(request[1].body))).not.toHaveProperty(
      "dynamic_variables",
    );
  });
  /** Queued/ringing calls are canceled, active calls are completed; no transfer phone is inferred. */
  it("cancels ringing calls and ends connected calls", async () => {
    settings();
    const sid = `CA${"a".repeat(32)}`;
    for (const status of ["ringing", "in-progress"]) {
      const fetcher = vi.fn(
        async (_url: string, init: RequestInit) =>
          new Response(
            JSON.stringify({
              status:
                init.method === "GET"
                  ? status
                  : status === "ringing"
                    ? "canceled"
                    : "completed",
            }),
          ),
      );
      vi.stubGlobal("fetch", fetcher);
      await controlCall(sid);
      expect(
        new URLSearchParams(String(fetcher.mock.calls[1][1].body)).get(
          "Status",
        ),
      ).toBe(status === "ringing" ? "canceled" : "completed");
    }
  });
  /** A takeover uses only the approved E.164 number and explicitly leaves the provider connection result unconfirmed. */
  it("requests a direct patient hand-back and rejects unsafe control references", async () => {
    settings();
    const sid = `CA${"b".repeat(32)}`;
    const fetcher = vi.fn(
      async () => new Response(JSON.stringify({ status: "in-progress" })),
    );
    vi.stubGlobal("fetch", fetcher);
    await controlCall(sid, "+15555550101");
    const request = fetcher.mock.calls[1] as unknown as [string, RequestInit];
    expect(new URLSearchParams(String(request[1].body)).get("Twiml")).toContain(
      "<Number>+15555550101</Number>",
    );
    await expect(controlCall("arbitrary", "+15555550101")).rejects.toThrow(
      /Invalid call/,
    );
    await expect(controlCall(sid, "<Dial>")).rejects.toThrow(/Invalid patient/);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
