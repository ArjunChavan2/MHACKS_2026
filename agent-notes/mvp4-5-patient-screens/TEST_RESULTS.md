# Validation

- `npm test -- --maxWorkers=2`: 186 tests passed across 26 files, with provider calls mocked. Covers approval/schema checks, unsaved/changed preferences, holds, cross-case sessions, replaced plans, duplicate starts, disabled live configuration, original-turn outcome references, unchanged savings, proposal timeout, exact SID transcript association, Twilio cancel/end/transfer payloads, ElevenLabs client-data nesting, consent expiry and denial confirmation/evaluation/reload/unknown/missing-criteria branches.
- `npm run lint`: passed.
- `npm run typecheck`: passed; production build also completed its TypeScript check.
- `npm run build -- --webpack`: passed, including both new API routes and all existing pages.
- Chrome/Playwright checks at 1440, 390 and 320 pixels used real local service endpoints with synthetic fixtures for approval → rehearsal → proposal decision → outcome save/reload, denial notice → evidence → appeal PDF/download/reload and missing-criteria doctor request. Actual downloads have PDF bytes and the correct appeal filename. No horizontal overflow or browser runtime errors.
- Additional 390px checks: arrived denial classification was intercepted with a saved synthetic fixture; the existing case routed it to denial review without fulfilling a billing task, and reload retained the central case. Unknown policy displays human handoff and drafts nothing.
- Additional 1440px check: three mocked provider refresh failures pause automatic polling; after another interval no fourth request occurs. End and Take over remain available.
- Screenshots: `/private/tmp/billless-call-outcome-{1440,390,320}.png` and `/private/tmp/billless-denial-{1440,390,320}.png`; browser harness `/private/tmp/billkind-browser-tools/call-appeal.cjs`. These are local synthetic review artifacts, not repository dependencies.

Merged current main (949e81a), preserving insurer-only letters, patient-confirmed call outcomes and correction/review-progress behavior. Combined tests pass; exact-call polling retains the newer provider outcome metadata as proposals.

No real telephone call, provider-agent mutation or patient message was made. Real outbound availability and trial acceptance were not tested. Live workspace default remains disabled; deployment requirements are in docs/CALL_WORKSPACE.md.
