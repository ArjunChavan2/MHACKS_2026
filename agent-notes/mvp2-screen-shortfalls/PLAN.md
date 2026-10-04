# Plan: complete the patient case journey

Planning deliverable, October 4, 2026. No implementation is included. SPEC.md remains authoritative. This plan closes outstanding MVP 1–2 screen gaps while preserving MVP 3; MVP 4–5 entries below are sequencing notes for their own implementation phases.

## Goal

A patient can state their goal, understand the document-processing wait, and add requested documents to the same case without using the simulated operator console. New evidence is confirmed and checked before the case changes its findings or claims verified savings.

## Relevant requirements

- SPEC.md §2: deterministic findings with citations, verbatim record facts, explicit patient approval for contact/disclosure/commitments, human takeover, and synthetic data only.
- §3.1 and §6 MVP 2: persistent goal and constraints, adaptive branches, wait/resume, and proof before resolution.
- §4.2: classification, schema/provenance checks, patient confirmation, and visible failures before audit.
- §4.6–4.7: document tracking, approvals, takeover and questioned/offered/confirmed amounts.
- §5: strict TypeScript, boundary validation, detailed docstrings, meaningful tests, and agreement on shared interfaces.
- Preserve DESIGN_HANDOFF.md typography, spacing, mobile controls, Billy copy and simulation labels.

## Repository observations

- `BillAuditApp.tsx` implements start, confirm, audit, request, letter and case views inside `/review`; these do not need new top-level routes.
- Busy feedback is generic “Reading document…”; the synchronous upload API does not expose live classification/extraction stages.
- `CaseScreen.tsx` already has approvals, iMessage linking, finding evidence, paperwork tasks, timeline, savings and revised-statement confirmation. Extend it rather than rebuilding it.
- `POST /api/documents` accepts an existing `caseId`; the intake UI already uses that contract. The case screen has no upload control.
- `machine.ts` includes `attach_document` as an action, but the actions route accepts only contact and takeover actions. File attachment belongs through the documents API.
- `StoredCase` has a nullable goal, but ingest creates cases with `createCase(null)`. `CaseSnapshot` has no patient constraints; capturing them requires service/state work.
- `confirmDocument` invokes revised-statement verification. Arbitrary supporting-record uploads are not established as an end-to-end supported intake path; inspect supported schemas before enabling them.
- `/api/appeals`, denial extraction/confirmation and deterministic criteria evaluation exist. `BillAuditApp` does not provide a complete denial journey.
- No `voice/` implementation or live call UI was found. A call screen depends on MVP 4 integration, not styling alone.
- Existing plans: `frontend-screens`, `mvp2-adaptive-case`, `mvp3-imessage`, and `mvp5-denial-appeal`. Their earlier implementation assumptions must be checked against current code.

## Proposed architecture

Keep `/review` as the patient workspace. Add a short case-setup step and a reusable document-upload/confirmation flow accessible from case tracking. Use the existing APIs and server-derived next-action card. Introduce only the additive case-preferences interface required to persist and enforce the patient's goal and constraints.

Do not put findings, savings calculations or action authorization in React. Processing feedback initially describes the overall request; stage labels require real server events and are outside the first UI pass. Parser speed investigation remains tracked separately in GitHub issue #7.

## Interfaces and data flow

### Case preferences

Propose a validated `PATCH /api/cases/[id]` for `{ goal, constraints }`, with a versioned `case_preferences_updated` event. Return preferences through `CaseView`; use the same reducer in web actions and iMessage authorization. Confirm the final contract with the shared-types/backend owner before implementation.

Use explicit supported constraints, starting with “Do not agree to payments” as required by the demo. Store any additional patient instruction verbatim for human review; never claim arbitrary prose is automatically enforced. Unsupported or conflicting instructions require handoff before dependent actions. Legacy cases have no explicit goal and no recorded constraints; never imply consent or invent a goal.

The existing first upload can create the case. Collect preferences in intake, save them immediately after the case ID exists, and require a successful save before enabling subsequent case actions. On resume, load stored preferences. Editing constraints must revalidate future actions and pending approvals; stale approvals cannot authorize newly restricted actions.

### Documents arriving during a case

`CaseScreen` opens an attachment flow → `POST /api/documents` with `file` and current `caseId` → show actual detected type → patient corrects/confirms through the existing confirmation API → supported deterministic checks run → refresh `CaseView`.

Keep the original bill separate from revised statements and additional EOBs. Bind an arrived document to the intended task/finding through a validated service contract; uploading alone must not complete a task. Verify case ownership of document/task IDs. Reuse the existing revised-statement verification path. For a new EOB, identify the correct original bill and rerun the applicable audit with status-preserving merge. For supporting documents without a supported extraction schema, explain the limitation and offer human handling; do not infer clinical evidence from free text.

## Ordered implementation steps

### 1. Make the current processing wait understandable

- Add a visible processing panel near the upload controls: filename, elapsed wait, overall request status and an accessible status announcement.
- Prevent accidental duplicate submissions; retain other uploaded documents and corrections after failure.
- Show actionable timeout/provider/unreadable-document errors with an explicit retry control. A retry must not silently create duplicate persisted documents; check current ingestion behavior before promising this.
- Do not show made-up percentages, estimated completion times or stage changes. Do not announce every timer tick to screen readers.
- Keep performance instrumentation/optimization in issue #7; this step does not claim to reduce latency.

### 2. Capture and enforce case goal and constraints

- Add the intake setup fields and a compact preferences summary/edit control in case tracking.
- Implement the additive persistence/view contract above with schema validation and detailed docstrings.
- Feed supported constraints into shared authorization, including iMessage. Preserve a no-payment guard even though current MVP actions do not offer payment commitments.
- Disable dependent actions if preferences fail to save; show retry and human takeover.

### 3. Let patients attach arrived documents

- Add “Add a document” to case tracking and contextual attachment actions on relevant open paperwork tasks.
- Reuse confirmation UI with an explicit return to the case; support itemized bills, EOBs and revised statements only where extraction and deterministic handling exist.
- Record receipt and confirmation distinctly. Match the intended task and evidence before marking it received/completed.
- Display original/revised document versions and links in a compact document list, retaining source citations.
- Refresh findings, next action, timeline and savings from the server after successful checks. Preserve the previous case view on failure.

### 4. Verify the complete current-rung journey

- Walk through the confirm-error, disproves-concern and incomplete-evidence branches.
- Demonstrate a waiting case receiving a revised statement from the patient UI, confirming it, and verifying the outcome without the operator attaching the statement.
- Confirm resume links and existing iMessage approvals still work. Record implementation, audit and test outputs in this task folder; update current status documentation after the work is actually complete.

## Later-rung screen sequence

These entries are backlog handoffs, not authorization to implement later MVPs in this task.

| Rung | Screen/flow | Dependency and acceptance gate |
| --- | --- | --- |
| MVP 4 | Pre-call approval | Working call service; display recipient, purpose, approved disclosures and patient constraints before placing a call. |
| MVP 4 | Live call | Server call state and transcript, current decision prompt with 2–4 options/free-text instruction, and functioning Take over. Timeout agrees to nothing; failure/disconnection is visible. |
| MVP 4 | Call outcome | Recorded outcome, written-proof requests and follow-up tasks; verbal offers remain offered rather than confirmed savings. |
| MVP 5 | Denial confirmation | Extend intake routing/field rendering for denial documents using existing extraction/confirmation support. |
| MVP 5 | Criteria and evidence | Call existing appeals API only after confirmation; show met/missing/unconfirmed criteria with verbatim sourced records and unsupported-policy handoff. |
| MVP 5 | Appeal/request review | Display returned draft and its sources; provide only export/submission capabilities that actually exist, with explicit approval before any future submission. |

## Edge cases and failure modes

- Refresh during processing: avoid fabricated persisted job status; keep a clear recovery path within the current synchronous design.
- Expired/unknown case, unsupported file/type or multiple billing entities: explain the supported next step; never silently assign a different case or overwrite the original bill.
- Duplicate upload, stale task, conflicting EOB, mismatched revised statement: preserve existing evidence and refuse unsupported transitions.
- Failed/blocked confirmation: no rerun, resolution or savings confirmation.
- New restrictions while an approval is pending: revalidate on the server for both web and messaging.
- Unreadable/missing fields and broken totals: reuse existing blocking checks and patient correction gates.
- Network/polling failure: keep last loaded case information and visibly mark that refresh failed.

## Assumptions and open questions

- The implementation scope is outstanding MVP 1–2 work with MVP 3 compatibility. SPEC.md status and HANDOFF.md are partially stale; repository observations take precedence for what exists, while SPEC.md determines required behavior.
- One synthetic demo patient and existing saved-case links remain the model; a case-list dashboard and login are not added requirements.
- Broad clinical-document ingestion is deferred until a supported schema and provenance-preserving rule path exist. Initial attachment support must reflect this honestly.
- No new background-job infrastructure is necessary for the first processing-feedback pass. True stage events can be planned after issue #7 establishes the bottleneck.
- Shared types/store/API changes require the repository's branch/PR workflow; coordinate the preferences and attachment contracts with backend work before editing shared code.
- Before implementation, read the installed Next.js guide relevant to client state, route handlers and routing in `node_modules/next/dist/docs/` as AGENTS.md requires.

## Verification strategy and completion criteria

- Meaningful service tests: preferences survive reload; restrictive changes invalidate dependent approvals; document/task IDs cannot cross cases; attachment does not complete a task before confirmation; revised proof is required for confirmed savings; re-audit preserves recorded finding statuses.
- Test supported refusal paths, malformed request bodies and constraints through both web and iMessage.
- Browser walkthrough at desktop, 390px and 320px: processing/error/retry, keyboard focus, status announcements, setup persistence, attachment/confirmation/return to case and source links.
- Run `npm run lint`, `npm run typecheck`, `npm test`, and the repository-supported production build after implementation. Use synthetic fixtures; live model performance checks are separate from correctness tests.
- Done when all three case branches remain correct, a patient can complete the revised-document wait/resume flow, constraints remain effective across reload/channels, and no approval or evidence gate is bypassed.
