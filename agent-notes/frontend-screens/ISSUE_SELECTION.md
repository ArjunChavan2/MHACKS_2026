# Patient issue selection

Each review finding offers “Don’t include this issue.” Excluded issues remain listed separately with “Restore issue.” Choices persist on the same case through reloads and deterministic re-audits. The active item count and amount under review reflect selected issues, with overlapping line amounts counted only once by the server.

`POST /api/cases/[id]/findings` accepts a server finding ID and an exclusion boolean. The service retains the original status, evidence, and wording, and supersedes unsent drafts when selection changes. Exclusion is a patient preference, not evidence that a charge is correct, a withdrawn finding, or verified savings. Excluding every issue leaves the case reviewed with no issue selected; it does not claim resolution.

Letters, next actions, call briefs, and verification skip excluded issues. Selection changes are refused after recorded approval, correspondence, or calls, preserving the history of an active dispute. Unknown findings and cases are rejected.

Verification covers memory and Postgres persistence, re-audit retention, draft invalidation, letter selection, exclusion of every issue, restoration, unknown IDs, and refusal after sending. Browser checks cover excluding, restoring, reloading, and preparing a draft on desktop and mobile.
