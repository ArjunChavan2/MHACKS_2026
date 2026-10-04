# Review: patient case screen shortfalls

Self-review completed October 4, 2026; this is not an independent agent audit.

- Confirmed findings, citations, draft prose and savings remain server-authored. New UI copy describes administrative workflow only.
- Contact holds remove contact actions from the shared machine and are checked at execution; both web and iMessage are covered by service tests.
- Old approval events/text prompts are excluded after preference changes. Clearing a hold still requires a fresh explicit approval.
- Attachment identifiers are checked against the current case. Unsupported task/document matches are refused. Arrival does not complete a task before confirmation/checks.
- Revised statement identity and reliable totals are checked before locking confirmation and again before verification. Foreign/mismatched evidence cannot verify savings.
- Patient correction and blocking-error controls are reused rather than bypassed. Pending document task associations survive reload. Original/revised versions remain separate.
- Reviewed diff for unrelated changes, retained the concurrent balance-statement card update, and kept temporary artifacts and secrets out of the change.

Remaining limits are documented in IMPLEMENTATION.md: clinical document handling, conservative EOB matching, known-case sequential deduplication, and later-rung call/appeal UI.
