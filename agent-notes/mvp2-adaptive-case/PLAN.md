# PLAN: mvp2-adaptive-case

Planning phase output (`prompts/PLAN.md`). Do not treat anything here as implemented.

## Goal

Turn the MVP 1 one-shot audit into a **persistent case that adapts, waits, resumes, and verifies**
(SPEC.md §6 MVP 2, the safety-net demo for the FinchNode prize). After the audit, the patient sees
a case screen with the next action, blocker, approvals, documents, and timeline. A teammate playing
the billing office uses an **operator console** (labeled simulated) to answer in one of three
hidden branches. The case changes its plan to match the actual response, waits for promised
documents, resumes when they arrive, and marks savings **confirmed only when a revised statement
proves them**.

Demo (SPEC.md §6, 2 min): patient states goal and "don't agree to pay anything" → records from
Northstar and Quillhaven → findings → patient approves sending the dispute → operator picks a hidden
branch → agent confirms, withdraws, or leaves pending → "we'll send it later" → waiting → document
arrives → checks rerun → revised statement verified → savings confirmed only with proof.

## Relevant requirements

- §2 core rule: no health fact or finding written by an LLM. Findings change status only through
  deterministic code reacting to a recorded response or a patient-confirmed document, with a
  template note and cited source.
- §3.1 case contents; §3.2 loop with **allowed actions from deterministic guards in `lib/cases/`**,
  every action logged as a case event; §3.3 tools table (approval column); §3.4 routing (MVP 2 only
  needs *billing correction* and *missing documentation*); §3.5 three branches; §3.6 waiting and
  resuming; §3.7 stopping conditions → handoff; §3.9 "What happens next?" card.
- §4.6 paperwork tracker: per-document type, direction, status, method, counterparty, reference,
  cited findings, follow-up date; statuses requested/received/drafted/approved/sent/acknowledged/
  awaiting response/resolved; verification against a revised statement; savings questioned /
  offered / confirmed shown separately; timeline.
- §4.7 approval gate before any send/contact/commitment; Take over on drafts (edit, "I'll do this
  myself"); every handoff logged.
- §6 MVP 2 exit criteria: all three branches produce the correct plan change; waiting/resuming
  works; nothing happens without approval; resolved vs pending is accurate. *If behind:* two
  branches (confirm, incomplete) and one revised statement.
- Out of scope (later rungs): iMessage (MVP 3), calls (MVP 4), denial appeals (MVP 5), real
  sending of letters, Neon Auth.

## Repository observations

- `lib/cases/service.ts` drives MVP 1: `ingestUpload/ingestSample`, `confirmDocument`,
  `auditCase`, `draftLetter`, `draftItemizedRequest`, `getCaseView`. Case status is a free string
  (`audited`, `letter_drafted`, `request_drafted`).
- **Pitfall:** `auditCase` and `draftLetter` re-run `runAudit` from scratch and
  `store.saveFindings` **replaces** all findings (`neonStore` deletes then inserts). Any status set
  by a response would be wiped on the next audit. MVP 2 needs a merge.
- `lib/cases/store.ts` `CaseStore`: createCase, setCaseStatus, getCase, saveDocument, getDocument,
  saveFindings, addEvent, putFile, getFile; memory and Neon implementations; tests run the service on
  both (`tests/db/store.test.ts`, PGlite).
- `db/schema.ts` already has `approvals` and `deadlines` tables (unused, no store methods). No
  per-document metadata column (method, counterparty, reference, cited findings). No `calls` table
  (MVP 4).
- `Finding.status` already allows `potential | confirmed | withdrawn | pending` (`lib/types`).
- `DocType` includes `revised_statement`; the extraction pipeline already routes it down the bill
  path, so a revised statement can be uploaded, extracted, and confirmed like a bill.
- Records: `loadRecords()` (`lib/finchnode`) returns records + `origin`; the demo patient is Priya
  Ramaswamy (synthetic); fixtures in `scripts/fixture-data.ts` (duplicate TSH lines 3/5, bill over
  EOB by $68 via line 5, free T4 line 4 documentation gap citing Northstar's 2026-03-02 result).
- UI: single component `app/_components/BillAuditApp.tsx` with steps start/confirm/audit/letter/
  request and `?case=` reload. Paper design (`agent-notes/mvp1-paper-frontend/`).
- LLM: `lib/llm` (Grok default, Gemini for the judged demo). Letters: `lib/draft/letters.ts`
  (`letterText` placeholders, template fallback).
- Shared Neon database (project Bil-less): **any migration affects every teammate**; announce before
  `npm run db:migrate` (docs/NEON_SETUP.md).

## Proposed architecture

Keep the deterministic core pure and small; put all persistence in the store; keep the LLM optional.

1. **`lib/cases/machine.ts` (pure).** `deriveState(storedCase) → CaseState` (phase, findings with
   status, open tasks, approvals, documents, blocker). `allowedActions(state) → AllowedAction[]`
   (id, label, needsApproval, target). `recommendAction(state) → NextAction` (deterministic
   routing per §3.4/§3.5: the "What happens next?" card content from templates). No I/O.
2. **Phases** (stored in `cases.status`): `intake` → `audited` → `awaiting_approval` →
   `waiting_response` → `waiting_document` → `verifying` → `resolved` | `handoff`. `resolved` only
   when every finding is `confirmed` (with a verified revised statement) or `withdrawn`.
3. **Responses as recorded events, not LLM interpretation.** The operator console posts a
   structured response per finding (`confirms_error`, `provides_documentation`,
   `needs_more_info`, `will_send_later`) with optional attached document and free-text note. The
   free text is stored and shown verbatim but never parsed. `applyResponse(state, response)` is
   pure and returns finding status changes + new tasks, each with a template note and a source
   pointing at the response event or document.
4. **Findings merge.** `mergeFindings(previous, fresh)`: keep status/statusNote/statusSources of
   any finding ID still produced by the rules; add new IDs as `potential`; drop IDs no longer
   produced only if they were `potential` (otherwise keep and flag in the timeline). `auditCase`
   and `draftLetter` use it instead of overwriting.
5. **Verification.** `compareRevised(original: ConfirmedBill, revised: ConfirmedBill, findings)`
   (pure, `lib/cases/verify.ts`): lines removed or reduced, new amount due, per-finding result
   (`resolved` if all its `lineNumbers` were removed/zeroed; `not_reflected` otherwise; `new_charge`
   if the revised bill adds lines). Confirmed savings = original due − revised due, only from a
   patient-confirmed revised statement. Offered savings = sum of amounts on findings the office
   said it would fix (`confirms_error`) but not yet verified.
6. **Approvals and Take over.** Store methods for the existing `approvals` table. Sending the
   dispute (simulated "sent via portal"), requesting a document, and any future contact require an
   approval row first; the service refuses the action otherwise. Draft letters are editable (edited
   text saved as a new outgoing draft with `author: "patient"`; patient-written text is not run
   through the placeholder guard). Tasks can be marked "I'll do this myself" (handoff event).
7. **Optional LLM pick (last step, flag-gated).** `chooseAction` may ask the model to pick one ID
   from `allowedActions`; the reply is validated against the list; card text stays template-only.
   Default is the deterministic `recommendAction`. This satisfies §3.2 without letting the model
   write any fact.
8. **UI.** A new `CaseScreen` (patient) rendered after the letter step and on `?case=` reload:
   "What happens next?" card, findings with status chips and notes, savings (questioned / offered /
   confirmed), tasks with responsible party and follow-up date, documents tracker, approvals, and a
   timeline. A separate `/operator` page (labeled **Simulated billing office**) for the teammate.

## Interfaces and data flow

### Types (`lib/types/index.ts`, additive and optional so stored rows stay valid)

```ts
// Finding additions
statusNote?: string;          // template text explaining the latest status change
statusSources?: Source[];     // response event or document behind the change
// new Source kind
| { kind: "response"; eventId: string; from: string; receivedAt: IsoDate; note: string | null }
| { kind: "document"; documentId: string; docType: DocType; label: string }

type ResponseKind = "confirms_error" | "provides_documentation" | "needs_more_info" | "will_send_later";
interface CounterpartyResponse {
  from: string;                       // e.g. "Quillhaven Medical Group billing office"
  perFinding: Array<{ findingId: string; kind: ResponseKind; neededDocument?: string; responsibleParty?: string; promisedBy?: IsoDate }>;
  documentId?: string;                // attached document (letter, lab result, revised statement)
  note?: string;                      // shown verbatim, never parsed
}
interface CaseTask { id; kind: "await_document" | "request_document" | "follow_up"; findingId?; documentNeeded; responsibleParty; followUpDate: IsoDate | null; status: "open" | "done" | "patient_handling"; }
interface NextAction { actionId; title; why; needed; responsibleParty; deadline: IsoDate | "unconfirmed" | null; needsApproval: boolean; citedFindingIds: string[] }
```

### Store (`lib/cases/store.ts`, both implementations + PGlite tests)

- `addApproval(caseId, action, details) → id`, `listApprovals(caseId)` (existing `approvals` table).
- `upsertTask(caseId, task)`, `listTasks(caseId)`: use the existing `deadlines` table
  (`kind`, `documentId`, `dueDate` = follow-up date, `reminderState` = task status) **plus** a JSON
  column for the rest (see migration).
- `updateDocumentMeta(id, meta)`; `StoredDocument.meta` (method, counterparty, referenceNumber,
  citedFindingIds, fulfillsTaskId, sentAt, receivedAt, status history).
- `saveFindings` unchanged signature; callers pass merged findings.
- `StoredCase` gains `approvals` and `tasks`.

### Migration `0002` (one, announced to the team before `db:migrate`)

- `documents.meta jsonb` (nullable).
- `deadlines.details jsonb` (nullable) for task fields not in columns.
No other schema changes. Old rows read with defaults.

### Service (`lib/cases/service.ts` or a new `lib/cases/actions.ts`)

- `getCaseView` returns `{ ..., state: CaseState, next: NextAction, allowed: AllowedAction[], timeline }`.
- `approveAndRun(caseId, actionId, details)`: checks `actionId ∈ allowedActions`, writes approval,
  performs it (e.g. mark dispute `sent` with method `portal (simulated)`), logs events, sets phase.
- `recordResponse(caseId, response)` (operator): validates finding IDs, stores the event, runs
  `applyResponse`, saves merged findings and tasks, sets phase.
- `attachDocument(caseId, file|sample, { fulfillsTaskId? })`: existing ingest + link to task; for
  `revised_statement`, after patient confirmation run `compareRevised` and update findings/savings.
- `markPatientHandling(caseId, taskId)` (Take over), `saveEditedDraft(caseId, draft)`.

### API routes (App Router, async `params`; read `node_modules/next/dist/docs/` first)

- `POST /api/cases/[id]/actions` `{ actionId, details? }` → updated view (403-style 409 if not allowed / no approval).
- `POST /api/cases/[id]/responses` `{ CounterpartyResponse }` (operator only; label simulated).
- `POST /api/cases/[id]/tasks/[taskId]` `{ status: "patient_handling" }`.
- Reuse `POST /api/documents` (multipart, add `taskId`) and `/api/documents/sample` (new branch samples).

### Fixtures (`scripts/fixture-data.ts` + `make-fixtures.ts`)

Branch documents for the Priya case (all labeled synthetic):
- `response-confirms.pdf`: billing office letter: line 5 billed in error, will be removed, revised
  statement to follow. Operator response: `confirms_error` for the duplicate and bill-over-EOB findings.
- `lab-result-ft4.pdf`: Quillhaven lab result showing a free T4 collected 03/05/2026 (synthetic).
  Operator response: `provides_documentation` for the free T4 gap → finding **withdrawn**, citing
  the document (patient confirms what the document is; no LLM reads it).
- `response-incomplete.pdf`: office says the lab order is with the lab department and will be sent
  later. Operator response: `will_send_later` (responsible party "Quillhaven lab department",
  promised date) → task + phase `waiting_document`.
- `revised-statement.pdf`: lines 1–4, amount due $253.00 (+ expected LLM output for the eval).
- Add `revised-statement` to `SAMPLE_NAMES` and to `scripts/eval-extraction.ts` CASES.

Branch map for the demo (operator picks one, agent never told):
| Branch | Operator response | Expected plan change |
|---|---|---|
| Confirms error | `confirms_error` on dup + over-EOB (+ letter) | Offered $68; task "await revised statement"; phase `waiting_document`; revised statement → confirmed $68, findings confirmed |
| Disproves concern | `provides_documentation` on free T4 gap (+ lab result) | Free T4 finding withdrawn with cited document; questioned drops by $54; plan continues with the duplicate |
| Incomplete | `will_send_later` on free T4 gap | Finding stays pending; task with responsible party and follow-up date; phase `waiting_document`; later arrival resumes |

## Implementation steps

Ordered; each ends with tests passing. Suggested owners in brackets (SPEC.md §6 MVP 2).

1. **Types + pure machine** [Dev 3]: types above; `lib/cases/machine.ts` (`deriveState`,
   `allowedActions`, `recommendAction`) and `applyResponse`; `mergeFindings`. Unit tests for each
   branch and for "no action without approval".
2. **Verification** [Dev 1]: `lib/cases/verify.ts` `compareRevised` + tests (line removed, amount
   reduced, unchanged, new charge, higher total).
3. **Store + migration** [Dev 4]: `0002` migration (`db:generate`, read the SQL, announce,
   `db:migrate`); store methods on memory + Neon; extend `tests/db/store.test.ts` for approvals,
   tasks, document meta, merged findings surviving reload.
4. **Fixtures** [Dev 1]: branch documents and revised statement; regenerate; run
   `npm run eval:extraction` (revised statement must match).
5. **Service + routes** [Dev 3/4]: `getCaseView` additions, `approveAndRun`, `recordResponse`,
   `attachDocument` with task link and revised-statement verification, Take over; switch
   `auditCase`/`draftLetter` to `mergeFindings`. Service tests on both stores walking all three branches.
6. **Case screen** [Dev 2]: "What happens next?" card, findings status/notes, savings trio, tasks,
   documents tracker, approvals, timeline; approve buttons call `/actions`; editable draft;
   "I'll do this myself". Keep MVP 1 steps working.
7. **Operator console** [Dev 2]: `/operator?case=` page, "Simulated billing office" banner, pick a
   branch preset (fills the structured response) or build one per finding, attach a sample document.
8. **Optional LLM action pick** [Dev 3, only if 1–7 are done]: `chooseAction` behind
   `AGENT_LLM_PICK=on`, validated against allowed IDs, falls back to `recommendAction`.
9. **Docs**: SPEC.md §6 status, HANDOFF.md, CLAUDE.md known errors if any; IMPLEMENTATION.md.

*If behind:* skip step 8, ship branches *confirms* and *incomplete* only, one revised statement.

## Edge cases and failure modes

- Audit rerun after a response must not reset statuses (merge; test it).
- Response referencing an unknown or withdrawn finding → 400, nothing changed.
- Two responses for the same finding → latest wins, both kept in the timeline.
- Revised statement that fails totals checks or isn't confirmed → no verification, stays `verifying`
  with a blocker.
- Revised statement with a **higher** amount or new lines → no savings; new lines flagged for review;
  phase `handoff` with a plain message.
- Revised statement removes a line not tied to any finding → savings counted only once against the
  original due; note it in the timeline.
- `confirms_error` without a revised statement → offered savings only; never confirmed.
- Action attempted without approval or not in `allowedActions` → refused, logged.
- Waiting task past follow-up date → card says overdue and proposes a follow-up (approval needed;
  reminder texts are MVP 3).
- Case reload mid-wait (Neon and memory) → identical state from stored data only.
- Old cases (MVP 1 rows without meta/tasks/approvals) → default empty, phase derived as `audited`.
- Operator console must never be reachable from the patient flow by accident; label everything
  simulated; no real sending anywhere.
- LLM unavailable → everything still works (deterministic routing, template letters).

## Open questions and assumptions

- **Assumption:** structured operator responses are an acceptable stand-in for parsing the office's
  free text (keeps §2; free text shown verbatim). Parsing letters with an LLM would need a patient
  confirmation step; not planned.
- **Assumption:** "sent" means recorded as sent via portal (simulated); no real email/fax.
- **Open:** a single demo user (no auth) is assumed (SPEC.md §12 item 6).
- **Open:** whether the judged demo uses the deterministic picker or the LLM pick (step 8).
- **Risk:** migration on the shared DB while teammates run the app; coordinate a time.
- **Risk:** UI scope is the largest; the card + findings + timeline are the must-haves.

## Verification strategy

- Unit (pure): `machine`, `applyResponse`, `mergeFindings`, `compareRevised`: one test per branch,
  approval refusal, merge survival, savings math ($68 offered → $68 confirmed only after revised
  statement; $54 removed from questioned when the free T4 is withdrawn).
- Service on memory and PGlite stores: full walk for each branch, including wait → attach →
  resume, and reload equality.
- Extraction eval includes `revised-statement.pdf` (Grok and Gemini).
- Manual demo script in the browser, desktop + phone width: run all three branches from the
  operator console in a second window; confirm card changes, statuses, savings trio, timeline.
- Exit criteria from SPEC.md §6 MVP 2 checked one by one in `TEST_RESULTS.md`.
