/**
 * @file Switches which ElevenLabs agent answers the Twilio number (one number, two briefs):
 * `npm run call:mode -- billing` (billing office dispute) or `npm run call:mode -- insurer`
 * (prior-authorization denial). Prints the current assignment with no argument.
 */

/**
 * Reads the current assignment, and reassigns the number when a mode is given.
 *
 * @returns Resolves when done.
 */
async function main(): Promise<void> {
  const key = process.env.ELEVENLABS_API_KEY;
  const phoneId = process.env.ELEVENLABS_PHONE_NUMBER_ID;
  const agents: Record<string, string | undefined> = { billing: process.env.ELEVENLABS_AGENT_ID, insurer: process.env.ELEVENLABS_INSURER_AGENT_ID };
  if (!key || !phoneId) throw new Error("Set ELEVENLABS_API_KEY and ELEVENLABS_PHONE_NUMBER_ID in .env.local");
  const mode = process.argv[2];
  if (mode) {
    const agentId = agents[mode];
    if (!agentId) throw new Error(`Unknown mode "${mode}" or its agent ID is not set (billing | insurer).`);
    const res = await fetch(`https://api.elevenlabs.io/v1/convai/phone-numbers/${phoneId}`, {
      method: "PATCH",
      headers: { "xi-api-key": key, "Content-Type": "application/json" },
      body: JSON.stringify({ agent_id: agentId }),
    });
    if (!res.ok) throw new Error(`ElevenLabs HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  const res = await fetch(`https://api.elevenlabs.io/v1/convai/phone-numbers/${phoneId}`, { headers: { "xi-api-key": key } });
  const data = (await res.json()) as { assigned_agent?: { agent_id?: string; agent_name?: string } };
  const current = Object.entries(agents).find(([, id]) => id === data.assigned_agent?.agent_id)?.[0] ?? "other";
  console.log(`Calls to the Twilio number now reach: ${data.assigned_agent?.agent_name ?? "(none)"} [${current}]`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

export {};
