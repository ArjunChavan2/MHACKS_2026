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
