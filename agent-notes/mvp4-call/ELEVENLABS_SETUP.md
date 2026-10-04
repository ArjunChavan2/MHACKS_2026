# ElevenLabs setup for `ask_patient` (PR #12)

For a teammate with access to the ElevenLabs dashboard or API. Until these steps are done, Billy
can't ask the patient by text; everything on the app side ships with the PR. Background and
behavior: `NOTES.md`, section "Ask the patient by text".

## 1. Add the `ask_patient` webhook tool to both agents (billing and insurer)

| Setting | Value |
|---|---|
| Type | Webhook (server tool) |
| Name | `ask_patient` |
| Description | Ask the patient by text for a detail you don't have (date of birth, member ID, address). Returns the patient's reply verbatim, or that nothing may be shared. |
| Method | `POST` |
| URL | `https://billless.tech/api/calls/ask` |
| Header | `x-billy-secret` = the Vercel `MESSAGING_SECRET` (same as the `request_patient_consent` tool) |
| Response timeout | 50–60 s (the app waits up to ~40 s for the patient's reply) |
| Body parameter `question` | string, required: the question as the office asked it |
| Body parameter `counterparty` | string, optional: who is asking (e.g. "Quillhaven Medical Group's billing office") |

## 2. Paste the updated insurer prompt into the insurer agent

Copy `agent-notes/mvp4-call/insurer-prompt.txt` into the insurer agent's system prompt. The billing
agent's rules come from the per-call brief (`lib/calls/brief.ts`), so they update on deploy and need
no paste.

## 3. Run the two new simulated tests

```bash
npm run agent:test -- ask_patient_answered
npm run agent:test -- ask_patient_skipped
```

Not run yet: the implementation session had no ElevenLabs key. Record the results in `NOTES.md`.
