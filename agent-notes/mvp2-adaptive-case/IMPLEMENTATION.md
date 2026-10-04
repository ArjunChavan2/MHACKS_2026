# IMPLEMENTATION: mvp2-adaptive-case (steps 1–2 of PLAN.md)

Status: **steps 1 and 2 done** (pure core + verification). Steps 3–9 not started. Nothing here
touches the database, routes, or UI yet; the MVP 1 flow is unchanged.

## What was built

| File | What |
|---|---|
| `lib/types/index.ts` | `Finding.statusNote / statusSources / verified` (optional); `Source` kinds `response` and `document`; `ResponseKind`, `CounterpartyResponse`, `CaseTask`, `RevisedComparison` |
| `lib/cases/verify.ts` | `compareRevised(original, revised, findings)`: matches lines by code + service date (revised statements renumber), earliest original first; removed / reduced / new lines; resolved and not-reflected findings; confirmed savings = drop in amount due, never negative, 0 if a total is missing |
| `lib/cases/responses.ts` | `mergeFindings`, `applyResponse`, `applyVerification`, `computeSavings`, `CaseRuleError`, `REVISED_STATEMENT` |
| `lib/cases/machine.ts` | `CaseSnapshot`, `derivePhase`, `allowedActions`, `canRun`, `recommendAction` (the "What happens next?" card), `NEEDS_APPROVAL` |
| `app/_components/BillAuditApp.tsx` | `describeSource` handles the two new source kinds (one-liners) |
| `tests/cases/machine.test.ts`, `tests/cases/verify.test.ts` | 12 tests: approval gate, all three branches on the Priya demo case, wait → overdue follow-up → resume, merge survival, resolution, verification edge cases |

## Behavior (for steps 3–7)

- **Responses** (`applyResponse`): `confirms_error` → `confirmed`, `verified: false`, opens one
  `await_document` task for the revised statement; `provides_documentation` → `withdrawn` (document
  required), closes that finding's open tasks; `needs_more_info` → `pending` + `request_document`
  task (sending it needs approval); `will_send_later` → `pending` + `await_document` task with
  responsible party and promised date. Unknown/withdrawn finding → `CaseRuleError`, nothing changed.
  Notes are templates; the counterparty's `note` is copied verbatim into the `response` source.
- **Verification** (`applyVerification`): resolved findings → `confirmed` + `verified: true`;
  confirmed-but-still-billed → note "not verified yet"; closes the revised-statement task.
- **Savings** (`computeSavings`): questioned = non-withdrawn findings; offered = confirmed, not
  verified; confirmed = `compareRevised(...).confirmedSavingsCents` or `null`. Each line counted once
  (reuses `computeVerdict`).
- **Phase** is always derived from facts (`derivePhase`), never trusted from `cases.status`:
  intake → audited → awaiting_approval → waiting_response → waiting_document → verifying → resolved.
- **Approvals**: `send_dispute`, `request_document`, `request_revised_statement`, `follow_up` need a
  matching approval (`{ action, target }`). `canRun` refuses anything not in `allowedActions` or not
  approved; the service must call it before performing an action (step 5).
- **Dates** are passed in (`today`, `receivedAt`) so everything stays pure and testable.

## Notes for the next steps

- Step 3 (store): `CaseSnapshot` is what the service must assemble: `dispute` from the outgoing
  dispute document + its meta (`sent`, `sentAt`), `tasks` from `deadlines` (+ `details` JSON),
  `approvals` from the `approvals` table, `responsesRecorded` = count of `response_recorded` events,
  `revisedAwaitingConfirmation` = an attached `revised_statement` document not yet confirmed.
- Step 5 (service): call `mergeFindings(stored, runAudit(...).findings)` in `auditCase` and
  `draftLetter` instead of overwriting. Store the response event first so its ID goes into
  `applyResponse`'s `ctx.eventId`.
- The demo verdict numbers: questioned $122.00; confirms branch offers $68.00, then confirms $68.00
  after the revised statement ($321.00 → $253.00); disproves branch drops questioned to $68.00.

## Checks

`npx tsc --noEmit`, `npm run lint`, `npx vitest run` (79 tests), `npm run build`: all clean.
