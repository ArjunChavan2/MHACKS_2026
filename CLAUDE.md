# CLAUDE.md

MHacks 2026 project. **`SPEC.md` is the single source of truth**: product, rules (§2), agent model
(§3), capabilities (§4), engineering rules and docstrings (§5), MVP ladder (§6), obstacles (§7).
If anything here or in the Google Doc disagrees with SPEC.md, SPEC.md wins.

Picking up mid-project? Read `HANDOFF.md` for current state and next steps.

First time on a machine: run `npm run setup` (details in `docs/NEON_SETUP.md`).

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

- **Gemini call hangs forever / `fetch failed` ECONNRESET / 503 "high demand".** The SDK had no
  timeout. Fix: `REQUEST_TIMEOUT_MS` per attempt plus `withRetry` (retries 429/5xx, network errors,
  aborts; then `LlmBusyError` → API 503 `ai_busy`) in `lib/llm/index.ts`.
- **EOB rejected as "several billing entities".** The classifier counted the insurer. Fix: the
  classify prompt says an insurer is never a billing entity (`lib/extract/pipeline.ts`).
- **`gemini-flash-latest` alias kept failing with 503/429** during the live eval while
  `gemini-3.5-flash` passed 334/334 fields. Fix: default pinned to `gemini-3.5-flash` in `lib/llm/index.ts`.
  `gemini-2.5-flash` returns 404 for new keys.
