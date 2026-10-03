# CLAUDE.md

MHacks 2026 project. Spec: `spec/PROJECT.md`.

## Workflow

Each task (e.g. `finchnode-sync`, `emergency-page`) goes through four phases, each run in a fresh
session with its prompt from `prompts/`:

1. **Plan** (`prompts/PLAN.md`) → `agent-notes/<task>/PLAN.md`
2. **Implement** (`prompts/IMPLEMENT.md`) → `agent-notes/<task>/IMPLEMENTATION.md`
3. **Audit** (`prompts/AUDIT.md`) → `agent-notes/<task>/AUDIT.md`
4. **Test** (`prompts/TEST.md`) → `agent-notes/<task>/TEST_RESULTS.md`

Start a phase with e.g. "Follow prompts/PLAN.md for task `finchnode-sync`: <what the task is>."
Notes are per task because four developers run phases in parallel.

## Repository rules

- **AI never writes or hides a health fact.** Health facts reach users verbatim from FinchNode,
  with source attached; the passport is built by deterministic rules; the AI may only reorder
  existing items. See `spec/PROJECT.md`.
- Never commit secrets; keys go in `.env` (gitignored).
- Never use real patient data; use the FinchNode synthetic sandbox or the local mock.
- Never add Claude as an author or co-author on commits.

## Known critical errors and fixes

A running log of real bugs hit in this repo and how they were actually fixed, so future sessions
don't rediscover them. Add an entry whenever a bug costs more than a few minutes.

_None yet._
