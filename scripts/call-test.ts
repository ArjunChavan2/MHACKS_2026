/**
 * @file Test call (MVP 4 spike): the ElevenLabs agent calls DEMO_BILLING_PHONE from our Twilio number
 * and the script prints status until the call ends. Run with `npm run call:test`. Places a real call.
 */
import { getCallStatus, placeAgentCall } from "../lib/calls";

/** Final Twilio statuses. */
const DONE = new Set(["completed", "busy", "failed", "no-answer", "canceled"]);

/**
 * Places the call and follows it.
 *
 * @returns Resolves when the call ends (or after 10 minutes).
 */
async function main(): Promise<void> {
  const to = process.env.DEMO_BILLING_PHONE;
  if (!to) throw new Error("Set DEMO_BILLING_PHONE in .env.local");
  const call = await placeAgentCall(to, { patient_name: "Priya Ramaswamy", account_number: "QMG-305518" });
  console.log(`Call placed to number ending ${to.slice(-4)}: ${call.sid} (${call.status})`);
  let last = call.status;
  for (let i = 0; i < 300; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const s = await getCallStatus(call.sid);
    if (s.status !== last) console.log(`  ${s.status}${s.duration !== null ? ` (${s.duration}s)` : ""}`);
    last = s.status;
    if (DONE.has(s.status)) return;
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
