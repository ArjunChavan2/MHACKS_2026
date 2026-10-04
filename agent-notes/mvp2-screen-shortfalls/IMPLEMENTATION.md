# Implementation: patient case screen shortfalls

Completed October 4, 2026 on `feat/mvp2-case-journey` in `/private/tmp/billless-case-journey`.

## What changed

- Intake collects an administrative goal, no-payment restriction and optional contact hold. Choices must save successfully before intake advances. Case tracking displays and edits them.
- Versioned preferences are stored as events, avoiding a database migration. The shared case machine removes contact actions during a hold; the web and iMessage use the same gate. Preference changes invalidate old approval events and text prompts.
- Uploads show filename and elapsed time with an accessible status, retain failed files for an explicit retry, and prevent rapid double submissions. No percentages or unsupported stage claims.
- Active cases accept arrived itemized bills, EOBs and revised statements. Reused confirmation controls preserve correction/blocking behavior and allow returning to the case. Pending uploads can reopen after reload with their task association retained.
- The server validates case/task ownership and supported task/document matches. Receipt alone does not fulfill a task. Confirmed EOBs rerun the original audit with status-preserving merge; matching revised statements use existing verification before confirmed savings.
- Revised-statement verification now requires matching provider, patient, account and service dates plus reliable original/revised totals. A mismatched statement remains unconfirmed. EOB matching is conservatively limited to provider and coded service dates because the existing schema lacks patient/account identifiers.
- Case tracking lists incoming documents and their confirmation status. The original bill is never replaced by a revision. Sequential retries of identical file bytes within an existing case reuse the stored extraction.

## Decisions and deviations

Preferences save on the explicit Continue action after the first upload creates a case, rather than automatically on receipt; no case contact is enabled before the patient saves. Two explicit supported restrictions are offered; arbitrary goal prose is never treated as machine-enforced constraints or findings. No payment action exists regardless of checkbox state.

The original checkout was changed by another session during verification. That session saved this work in `stash@{0}`. Recovered it into an isolated worktree and preserved the committed balance-statement card changes. The stash was retained; the other session's checkout was left untouched.

The existing exact case-view storage test now expects stored filenames, an intentional additive API field. No assertions were relaxed. Shared files were formatted with Prettier.

## Limitations

- Clinical supporting reports and unknown document types need human handling; they do not automatically withdraw findings.
- EOB identity checks cannot establish patient identity with the existing extraction schema.
- No live call or denial appeal UI is added; those remain separate MVP 4–5 work.
- Processing feedback does not reduce provider latency; parser optimization remains GitHub issue #7.
- Duplicate prevention covers sequential known-case retries. Concurrent requests and first uploads without a known case ID do not have an idempotency key.
- Existing demo case-ID access and simulated-send model remain in place. This is not a production authentication change.

## Validation

153 tests pass across 19 files, including memory and PGlite case/messaging scenarios, API input refusals, cross-case documents, restriction changes, document wait/resume and identical-upload retry. Lint, TypeScript and webpack production build pass. Synthetic Chrome walkthroughs cover 1440px, 390px and 320px widths with no horizontal overflow or runtime errors. Browser API traffic is intercepted with service-generated synthetic fixtures; no real patient data or live model calls were used. The preview runs at http://localhost:3002/review.

## Main integration

Resolved conflicts with current main before merging PR #8. Retained upstream call history and transcript controls, voice-agent code/tests, bill/EOB consistency checks and review layout/copy changes. Revision confirmation combines upstream mismatch descriptions with the attachment guard and returns blocking messages before locking mismatched values. Updated the new account-mismatch test to assert this existing confirmation response contract while retaining the unconfirmed/no-savings assertions. Combined suite: 153 tests in 19 files.
