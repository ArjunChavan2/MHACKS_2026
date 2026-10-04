# MVP 4 call: current state (proof of concept)

- Twilio trial: outbound calls are blocked (ElevenLabs one-step API, inline TwiML, recipient assignment).
  **Inbound works:** the verified billing phone dials +1 734-977-0915 → ElevenLabs agent "Bill-less caller".
- Agent settings (ElevenLabs): end_call tool on, end on 20 s silence, 5 min max. Prompt and first
  message: `agent-prompt.txt` (synthetic Priya case brief + hard rules). Apply changes via the
  ElevenLabs API or dashboard and keep this file in sync.
- Test calls 2026-10-04: hang-up fixed (end_call). Before the brief, the agent **invented** a patient
  name, DOB, and phone when asked; the brief now lists the only facts it may state and forbids
  inventing anything.
- Outbound code (`lib/calls`, `/api/calls/twiml`, `npm run call:test`) is built and deployed for when
  Twilio is upgraded.

## Automated agent tests (`npm run agent:test`)

ElevenLabs simulates the billing office from a script and grades the real agent's transcript
(text only, no phone). 5 scenarios × criteria: identity pressure (DOB/SSN/address), payment pressure
(pay today / plan / discount), prompt injection, cooperative clerk (raises all three issues + asks for
a written revised statement), and a clerk who disputes the duplicate and adds a late fee. Every
scenario is also graded on: invents nothing, no payment commitment, shares no sensitive data.
Result 2026-10-04: **all 23 criterion checks passed.** Run one scenario: `npm run agent:test -- injection`;
print transcripts with `AGENT_TEST_TRANSCRIPTS=1`. Uses the simulate-conversation endpoint
(deprecated 2026-10-31; move to ElevenLabs agent-testing API before then). The grader is an AI, so a
pass is strong evidence, not proof; keep live phone checks for voice and interruptions.

## Take over (patient verification), 2026-10-04

Billy has ElevenLabs' `transfer_to_number` tool (blind transfer) to `DEMO_PATIENT_PHONE` (the verified
trial number). When the office needs to verify identity, needs consent, or asks for the patient,
Billy says "One moment, I'll connect Priya so she can verify" and transfers. Saved transcripts show
"(Transferred the call to the patient)". Real-world basis: under HIPAA the office needs the patient's
verification/consent; the alternative is a signed authorization form on file.

**Demo:** the billing-office teammate calls +1 734-977-0915 from their own phone; the patient
teammate holds the verified phone (ending 1370). Office: "I need to verify the patient." → Billy
transfers → patient phone rings. Trial caveats: Twilio trials may only accept inbound calls from
verified numbers, and may block the transfer leg; if so, upgrade or show the simulated test
(`npm run agent:test -- identity_pressure` passes `takes_over`).
