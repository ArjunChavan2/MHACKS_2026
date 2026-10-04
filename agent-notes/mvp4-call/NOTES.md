# MVP 4 call: current state (proof of concept)

- Twilio trial: outbound calls are blocked (ElevenLabs one-step API, inline TwiML, recipient assignment).
  **Inbound works:** the verified billing phone dials +1 734-977-0915 → ElevenLabs agent "Bill-less caller".
- Agent settings (ElevenLabs): end_call tool on, end on 10 s silence, 30 min max. Prompt and first
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

## Consent by text (replaces phone transfer as the first step), 2026-10-04

When the office needs to verify the patient, Billy says "One moment, I'll ask Priya to confirm by
text" and calls the ElevenLabs webhook tool `request_patient_consent` → `POST /api/calls/consent`
(header `x-billy-secret` = MESSAGING_SECRET). Our app opens a consent request on the live case
(`DEMO_CASE_ID`, else the case Billy was briefed for at the start of this call) and texts the patient by iMessage.
Consent is iMessage-only (the website has no consent box or route); the case screen just says to
reply in iMessage, or to link a phone first. The patient must reply
exactly "I consent to Billy representing me"; the tool waits ~40 s. Billy reports consent ONLY when
the result says `"consented": true` (a simulation once showed it claiming consent from a generic
tool result; the prompt now forbids that and `consent_denied` tests it). Phone transfer stays as the
fallback if the office insists on the patient herself. Demo only: typed consent is not real
identity verification.

**Live demo:** on the case screen press **Get Billy ready for this case** (Calls section) right
before the call; Billy is briefed from whichever case pressed it last, so teammates using the site
don't move him →
billing teammate calls +1 734-977-0915 → "I need to verify the patient" → Billy texts the
patient's linked iPhone → reply with the phrase in iMessage → Billy tells the office within a couple of seconds.

## Insurer call (denial appeal), 2026-10-04

Second agent "Billy (insurer call)" (`ELEVENLABS_INSURER_AGENT_ID`), cloned from the billing agent
(same consent tool, transfer, end-call), brief in `insurer-prompt.txt`: the WMH-MP-112 prior-auth
denial (reference PA-2026-0402-1183) and Priya's FinchNode records quoted verbatim per criterion. Goals:
confirm reason/policy, cite each criterion, ask for reconsideration or expedited appeal, get what to
send and where, confirm the deadline, get a reference number. One Twilio number → switch which agent
answers: `npm run call:mode -- insurer` / `-- billing` (no argument prints the current one).
Tests: `npm run agent:test -- --insurer` (cooperative rep + pressure to withdraw/accept a cheaper
visit, with consent mocked false): all pass.

**Demo:** `npm run call:mode -- insurer` → teammate calls +1 734-977-0915 playing Wolverine Mutual
Health → Billy makes the case with the records → switch back with `npm run call:mode -- billing`.

## Phonetic alphabet, 2026-10-04

Both agents spell IDs with the NATO alphabet ("Q as in Quebec...") and digits one at a time, and
understand and read back phonetically spelled references. Tests: `spelling` and `--insurer insurer_spelling` (pass).

## Ask the patient by text (`ask_patient`), 2026-10-04

When the office asks for a detail Billy doesn't have (date of birth, member ID, address…), Billy
says "One moment, I'll ask <first name> by text" and calls the ElevenLabs webhook tool
`ask_patient` → `POST /api/calls/ask` (header `x-billy-secret` = MESSAGING_SECRET). The app texts
the patient the question through Photon on the live case (`DEMO_CASE_ID`, else the case whose screen last pressed "Get Billy ready", else the latest case),
waits ~40 s, and returns the patient's reply **verbatim**; Billy may read only that text back. SKIP,
no reply, or a late reply means nothing is shared. Code (`lib/cases/patientQuestions.ts`) refuses
questions about any part of an SSN, card or bank numbers, passwords, or PINs before texting, and
withholds replies that look like an SSN or card number. While a question is open (2 min), the
patient's next text is the answer (even "yes"); only STOP keeps its meaning. If no phone is linked
to the live case, the tool answers at once ("can't be reached by text").

**ElevenLabs setup (checklist: `ELEVENLABS_SETUP.md`; needs the ElevenLabs dashboard or API):** add a webhook
tool to both agents (billing and insurer):
- Name `ask_patient`; method POST; URL `https://billless.tech/api/calls/ask`; header
  `x-billy-secret` = the Vercel `MESSAGING_SECRET`; response timeout 50–60 s.
- Description: "Ask the patient by text for a detail you don't have (date of birth, member ID,
  address). Returns the patient's reply verbatim, or that nothing may be shared."
- Body parameters: `question` (string, required: the question as the office asked it),
  `counterparty` (string: who is asking).

The billing agent's rules come from the per-call brief (`lib/calls/brief.ts`), so they deploy with
the app; the static prompts (`agent-prompt.txt`, `insurer-prompt.txt`) were updated to match and must
be pasted into ElevenLabs for the insurer agent. New simulated tests: `npm run agent:test --
ask_patient_answered` and `-- ask_patient_skipped` (not run yet: no ElevenLabs key here).

**Texts are structured now:** every message starts with "BillLess · <kind>", the card's details are
bulleted, and approval prompts spell out the options ("A → Approve: Send the dispute letter",
"B → Hold for now (nothing is sent)", "WHY → See the evidence"). Options are never trimmed away.

## Consent first, announced texts, plain digits, 2026-10-04

Rules (in `lib/calls/brief.ts` for live calls and `insurer-prompt.txt`): Billy asks for consent of
representation right after the other side confirms who they are, before anything else; says out
loud every time he texts the patient (consent or `ask_patient`) and reports the reply; spells letters
phonetically but says digits plainly ("seven, seven, one", never "1 as in 1"). Both webhook tools use
ElevenLabs' forced pre-tool speech. `npm run agent:sync` pushed tools and prompts to both agents.

Simulations (`npm run agent:test`), all criteria passed: `ask_patient_answered`, `ask_patient_skipped`,
`cooperative` (incl. `consent_first`), `consent_denied`, `spelling` (incl. `digits_plain`);
`--insurer insurer_cooperative insurer_spelling`. Every scenario is also graded on `announces_texting`.
