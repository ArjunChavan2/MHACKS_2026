# IMPLEMENTATION: mvp2-adaptive-case (steps 1, 2, 4, 5 of PLAN.md)

Status: **steps 1, 2, 4, 5 done** (pure core, verification, branch fixtures, service + API). Step 3
is **not needed as planned** (see deviation). Steps 6–9 (case screen, operator console, optional LLM
pick, docs) not started. The MVP 1 UI flow is unchanged.

## Deviation from PLAN.md: no migration

Tasks, approvals, sends, responses, and verifications are stored as **case events** in the existing
`case_events` table instead of new `documents.meta` / `deadlines.details` columns. The latest
`tasks_updated` event holds the task list; `approval_recorded`, `dispute_sent`, `response_recorded`,
`correspondence_attached`, `document_requested`, `follow_up_sent`, `handoff`, `revised_verified`
carry the rest. Finding statuses live in `findings.body` (already JSON). Result: **no change to the
shared Neon database** and the timeline comes for free. The `approvals` and `deadlines` tables stay
unused; mirror approvals into `approvals` later if judges should see it in Neon.

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

## Steps 4–5 (fixtures, service, API)

| File | What |
|---|---|
| `scripts/fixture-data.ts`, `scripts/make-fixtures.ts` | `REVISED` statement (old line 5 removed, reprinted 1–4, $253.00 due) with expected output; `CORRESPONDENCE`: `response-confirms`, `lab-result-ft4`, `response-incomplete` PDFs (undated, labeled synthetic, never read by a model) |
| `scripts/eval-extraction.ts` | adds `revised-statement.pdf`; Grok 52/52 |
| `lib/cases/caseflow.ts` | `snapshotOf`, `caseStateOf` (phase, next card, allowed actions, tasks, savings, verification, timeline), `runCaseAction` (approval recorded before any send; refuses anything not allowed), `recordResponse` (operator), `attachCorrespondence`, `verifyRevisedStatement`, `today()` (`DEMO_TODAY` pins it), `CORRESPONDENCE_SAMPLES` |
| `lib/cases/service.ts` | `auditCase`/`draftLetter` merge findings (statuses survive reruns); letters skip withdrawn findings; `confirmDocument` verifies a revised statement on confirm; `loadCase` returns `state`; `revised-statement` added to `SAMPLE_NAMES` |
| `app/api/cases/[id]/actions/route.ts` | `POST { actionId, target?, approve? }`; 409 `not_allowed` when refused |
| `app/api/cases/[id]/responses/route.ts` | `POST CounterpartyResponse + attachSample?` (operator console, simulated) |
| `lib/http/index.ts` | `CaseRuleError` → 400, `ActionRefusedError` → 409 |
| `tests/cases/caseflow.test.ts` | 6 scenarios × memory and PGlite stores: approval gate, confirms → revised → verified $68, disproves → withdrawn, incomplete → wait → resume, overdue follow-up + take over, bad input changes nothing, reload equality |

### API for the case screen and operator console (steps 6–7)

- `GET /api/cases/[id]` → existing view plus `state: CaseState` (`phase`, `next` card, `allowed`
  actions with `needsApproval`/`approved`/`target`, `tasks`, `savings` {questioned, offered,
  confirmed}, `verification`, `timeline` of {at, type, summary}).
- Approve button: `POST /api/cases/[id]/actions { actionId: next.actionId, target: next.target, approve: true }`.
- "I'll do this myself": `{ actionId: "patient_takes_over", target: taskId }`.
- Operator presets (finding IDs from `view.audit.findings` by `rule`):
  - Confirms: `{ from, perFinding: [{dup, confirms_error}, {eob, confirms_error}], attachSample: "response-confirms" }`, then upload sample `revised-statement` to the case (`/api/documents/sample` with `caseId`) and have the patient confirm it.
  - Disproves: `{ from, perFinding: [{gap, provides_documentation}], attachSample: "lab-result-ft4" }`.
  - Incomplete: `{ from, perFinding: [{gap, will_send_later, neededDocument, responsibleParty, promisedBy: today+7}], attachSample: "response-incomplete" }`; later the lab sends `lab-result-ft4` as `provides_documentation`.
- Dates: `receivedAt` is today; set `DEMO_TODAY` for rehearsals with fixed dates.

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

`npx tsc --noEmit`, `npm run lint`, `npx vitest run` (91 tests), `npm run build`: all clean.
Live eval on Grok: 278/278 fields across 6 documents. HTTP smoke on `next start`: unknown case → 400,
invalid action → 400.
