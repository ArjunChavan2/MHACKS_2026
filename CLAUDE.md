# CLAUDE.md

MHacks 2026 project. **`SPEC.md` is the single source of truth**: product, rules (§2), agent model
(§3), capabilities (§4), engineering rules and docstrings (§5), MVP ladder (§6), obstacles (§7).
If anything here or in the Google Doc disagrees with SPEC.md, SPEC.md wins.

Picking up mid-project? Read `HANDOFF.md` for current state and next steps.

## Workflow

Each task goes through four phases, each run in a fresh session with its prompt from `prompts/`:

1. **Plan** (`prompts/PLAN.md`) → `agent-notes/<task>/PLAN.md`
2. **Implement** (`prompts/IMPLEMENT.md`) → `agent-notes/<task>/IMPLEMENTATION.md`
3. **Audit** (`prompts/AUDIT.md`) → `agent-notes/<task>/AUDIT.md`
4. **Test** (`prompts/TEST.md`) → `agent-notes/<task>/TEST_RESULTS.md`

Name tasks after MVP rungs, e.g. "Follow prompts/PLAN.md for task `mvp1-audit-rules`: <what>."
Notes are per task because four developers run phases in parallel.

## Repository rules

Follow SPEC.md §2 and §5. Never commit secrets, never use real patient data, never add Claude as an
author or co-author on commits.

## Known critical errors and fixes

A running log of real bugs hit in this repo and how they were actually fixed, so future sessions
don't rediscover them. Add an entry whenever a bug costs more than a few minutes.

_None yet._
