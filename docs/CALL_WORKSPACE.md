# Patient call workspace

The case screen now contains pre-call review, live status/transcript, and outcome review. Denial notices have a separate confirmation → policy evidence → correspondence journey. Patient approvals and outcomes are stored as case events; reload restores the same case.

## Review without contacting anyone

Open a checked sample-bill case, save case preferences, select Synthetic rehearsal, choose the exact disclosures, approve and save the plan, then start the rehearsal. Advance the fixed office response, choose Ask for written details or Decline, and finish. Review original transcript turns and save a proposed follow-up date/note. No provider call, message, payment, agreement, savings or automatic reminder is created.

## Live deployment contract

`CALL_WORKSPACE_ENABLED=false` is the default. Existing static synthetic inbound Billy configuration is insufficient for case-specific outbound calls. Enable only after deploying an agent with this contract and testing it with synthetic recipients:

1. Its prompt uses `{{approved_brief}}` as the sole case fact source. Remove the old hardcoded patient/account/health brief. It must not infer, paraphrase or expand clinical facts. Purpose text is a patient-authored goal, never evidence or a medical fact.
2. Scope is exact approved facts only. No payment, agreement, acceptance of conditions or further disclosure is permitted by these screens. All other requests hand back to the patient. The no-payment restriction is always enforced by this call path even if a legacy case has no saved restriction.
3. `request_patient_consent` POSTs `{caseId: {{case_id}}, sessionId: {{call_session_id}}, counterparty}` to `/api/calls/consent` with `x-billy-secret`. Forty seconds without a matching phrase sent through the linked iMessage conversation means no consent. Identity verification may still require direct patient contact.
4. `request_patient_decision` POSTs `{caseId: {{case_id}}, sessionId: {{call_session_id}}, statement}` to `/api/calls/decision` with `x-billy-secret`. The statement is the original office proposal, never an interpretation. Allow a 60-second tool timeout. Results are ask_written, decline or takeover; `agreementAuthorized` is always false. Do not treat written-details requests as accepted offers.
5. Configure `transfer_to_number` to use `{{patient_phone}}`. Transfer requires the patient's explicit request. If transfer fails, tell the office the patient will call directly and end. The browser takeover control replaces the assistant stream with Twilio Dial; this is a direct hand-back, not a warm conference transfer. A requested transfer is never labeled confirmed.
6. Configure required Twilio/ElevenLabs credentials, public `APP_URL`, `MESSAGING_SECRET` and the scoped `ELEVENLABS_AGENT_ID`. Trial outbound/transfer restrictions may still prevent calls. Credentials alone do not bypass the disabled flag.

When enabled, the conversation-initiation webhook resolves only the approved provider call SID and fails closed for unknown calls. The signed Twilio callback loads the approved briefing server-side; the URL carries only case/session references. The current ElevenLabs registration API nests dynamic variables inside `conversation_initiation_client_data`. Transcript association requires exact `metadata.phone_call.call_sid`; global latest-call guessing is not used by this workspace.

Original provider transcript publication may lag. Automatic polling pauses after three consecutive provider failures while End/Take over remain available. Polling shows pending/error states, and a finished call without a transcript can still receive a patient uncertainty note. Only verified revised documents affect savings. Proposed dates are saved notes, not a reminder scheduler or approved contact.

## Runtime limitations

Workspace writes are serialized per case inside a single process. Starting is recorded before the provider request; an uncertain timeout is terminal and asks the operator to check provider history before a new attempt. Multi-instance production needs database locking/idempotency and authenticated case ownership (the existing demo uses case IDs as access capabilities). Continuous revocation of an active call also needs provider callbacks/worker supervision; browser refresh ends an active assistant call when saved preferences change. Keep live calling disabled until these deployment needs are satisfied. No provider settings are changed by this PR.

Official API references: [Twilio call controls](https://www.twilio.com/docs/voice/api/call-resource), [ElevenLabs call registration](https://elevenlabs.io/docs/eleven-agents/api-reference/integrations/twilio/register-call), [conversation metadata](https://elevenlabs.io/docs/eleven-agents/api-reference/conversations/get).
