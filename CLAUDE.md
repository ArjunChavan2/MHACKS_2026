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
- **Gemini 429 "quota exceeded … limit: 20".** Free tier is 20 requests/day per project per model.
  Fix: Grok provider (`lib/llm/grok.ts`) is the default when `XAI_API_KEY` is set.
- **`The API version "6.4.299" does not match the Worker version "6.1.200"`** when rendering PDFs
  for Grok. `unpdf` bundles PDF.js 6.1.200; a newer `pdfjs-dist` clashes. Fix: `pdfjs-dist` pinned
  to exactly the version `unpdf` expects (check `node_modules/unpdf/package.json` before upgrading).
- **FinchNode sandbox simulate never finishes**: session stays `system-selected`, sync `partial`,
  `subject` null, `GET /users` empty (every attempt 2026-10-04). Not our bug. Workaround:
  `lib/finchnode/live.ts` falls back to the demo API, then the saved snapshot; failed Connect is
  cached for 10 min so audits don't each wait 45 s.
- **Grok uploads returned "unknown document" on Vercel only.** Two causes: PDF.js's worker
  (`pdf.worker.mjs`) is loaded by a runtime import the tracer misses, and PDF.js drew non-embedded
  standard fonts (Courier) with system fonts, which serverless Linux doesn't have, so pages rendered
  blank. Fix: `outputFileTracingIncludes` in `next.config.ts` (worker, `standard_fonts`, fixtures) and
  `useSystemFonts: false` + `standardFontDataUrl` in `lib/llm/pdfPages.ts`. Test uploads on the live URL.
- **`vercel link` rewrites `.env.local`** (it added `VERCEL_OIDC_TOKEN`; keys survived). Back it up first.
- **Texted case links pointed at `mhacks-2026.vercel.app`, not `billless.tech`.** Links used
  `APP_URL` (also Twilio's callback base) or the host the worker called. Fix: `PUBLIC_APP_URL`
  (set to `https://billless.tech` in Vercel) is read first in `publicOrigin` (`lib/messaging/auth.ts`).
- **PGlite suites fail at random with "Hook timed out in 10000ms"** when all test files run in
  parallel (migrations in `beforeAll`). Fix: `hookTimeout: 30_000` in `vitest.config.mts`.
- **New Gemini keys start with `AQ.`**, not `AIza`; that's Google's new format, not a wrong key.
- **Vercel "Resource is limited - try again in 24 hours" / "Deployment rate limited".** The Hobby
  plan allows 100 deployments a day, and every push to any branch was auto-deploying. Fix: git
  auto-deploys are off (`vercel.json` `git.deploymentEnabled: false`); deploy on purpose with
  `npx --cache "$HOME/.npm-cache-alt" -y vercel@latest deploy --prod --yes`.
