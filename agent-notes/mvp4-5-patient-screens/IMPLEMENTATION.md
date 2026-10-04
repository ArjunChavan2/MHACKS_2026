# Implemented flows

- Pre-call review: exact recipient/phone/purpose, patient takeover number, explicit disclosure choices from confirmed account data and deterministic findings, restrictions, unchecked approval checkbox, saved immutable plans.
- Live call: bounded provider requests, exact SID association, observable ringing/queued/active/failure states, original transcript publication, representation consent countdown, administrative proposal choices with silence=decline, explicit end/direct hand-back controls. Signed callback loads approved facts server-side rather than sending them in URLs. Current ElevenLabs client-data nesting corrected.
- Outcome review: original-turn selection, patient-authored notes, proposed follow-up/date, saved/reloadable history. A verbal offer never changes verified savings; no payment/conditional acceptance or automatic contact is exposed.
- Denial review: dedicated upload entry and sample; intake and existing-case arrivals route to confirmation. Original/corrected notice values, deterministic demo criteria, provider/date/code/record citations, unknown-policy human handoff, all-met appeal and missing-record doctor request. Reusable cited-letter/PDF screen; saved review is restored without rerunning a check. Denial-only case next-action card reflects correspondence review; mixed cases keep the central case screen.
- Existing legacy call history remains available for importing static inbound demo calls. Finished records can receive outcome notes in the new workspace.
- Consent replies now require a pending unexpired request; contact holds and late iMessage replies grant nothing. Expired requests show a visible fallback.
- Removed the old appeal template's unsupported assertion that the draft was already sent before its deadline.

No provider agent settings, real phone calls or external patient contacts were made during implementation/testing. Live outbound workspace calls default disabled. Synthetic rehearsal is fully connected to actual service/storage APIs. Deployment contract and remaining telephony/runtime limitations are in docs/CALL_WORKSPACE.md.
