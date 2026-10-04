# Implementation — MVP 1: cited bill audit (plus the MVP 0 pieces it needs)

Built directly from SPEC.md §4.2–§4.5 and §6 MVP 1, at the user's request, without a separate
PLAN.md. **Next phases: run `prompts/AUDIT.md` and then `prompts/TEST.md` for task `mvp1-bill-audit`.**

## What changed

- **Scaffold (MVP 0 subset):** Next.js 16 app (TypeScript, App Router, Tailwind 4), Vitest, Drizzle
  + Neon schema (`db/schema.ts`), `.env.example`, `drizzle.config.ts`. Next 16 notes: route
  `params` are async; read `node_modules/next/dist/docs/` before changing routing.
- **`lib/types/`:** the shared contract (fields with provenance, confirmed bill/EOB, `VerbatimFact`,
  findings with non-empty sources, verdict, drafts).
- **Fixtures:** `scripts/fixture-data.ts` + `scripts/make-fixtures.ts` (`npm run fixtures`) generate
  five PDFs with real text layers (sample bill, EOB, balance statement, broken totals, prompt
  injection), the expected raw model reply for each, and synthetic records for two providers.
- **`lib/llm/`:** only Gemini code; `generateJson` validates with zod, retries once, then throws.
  Model set in `GEMINI_MODEL` (default `gemini-3.5-flash`, pinned 2026-10-03; was the `gemini-flash-latest` alias).
- **`lib/extract/`:** classify → extract (one call per ≤4 pages, merged) → normalize → checks →
  text-layer cross-check → confirm. Saved-reply path (`extractFromSavedReply`) runs the identical
  normalization and checks for the labeled no-AI demo.
- **`lib/audit/`:** duplicate charge, bill exceeds EOB, documentation gap (demo lookup table), and
  the verdict (each line counted once).
- **`lib/draft/`:** placeholder fill + guard (rejects model-written amounts, dates, codes, unknown
  placeholders, skipped findings), template fallback, itemized-bill request, PDF rendering.
- **`lib/cases/`:** service layer for routes; store = Neon if `DATABASE_URL`, else in-memory.
- **API routes:** `/api/documents` (upload), `/api/documents/sample`, `/api/documents/[id]/confirm`,
  `/api/documents/[id]/file`, `/api/audit`, `/api/letters`, `/api/letters/pdf`,
  `/api/requests/itemized`.
- **UI:** `app/_components/BillAuditApp.tsx`: start, confirm, audit, letter, and itemized-request
  screens; sample-data banner whenever a saved reply was used.
- **Tests:** 42 Vitest tests (normalization, checks, cross-check, confirmation gate, pipeline with a
  fake model incl. retry/failure/injection, rules, verdict, drafting guard and fallback).
- **Eval:** `npm run eval:extraction` compares live Gemini extraction with the expected replies
  field by field (needs `GEMINI_API_KEY`).

## Important decisions

- The model only transcribes raw text; code normalizes values. So the cross-check compares the
  model's raw text with the PDF text, which catches hallucinated or injected values.
- Confidence comes only from checks (plus text-layer match for PDFs).
- Confirmation re-checks corrected values without the text layer (the patient's value need not be
  printed) and blocks until every flagged field is corrected or explicitly confirmed, and until
  broken totals are corrected or acknowledged.
- Duplicate findings question only the extra copies; bill-exceeds-EOB attributes its amount to bill
  lines the EOB lacks, so the verdict doesn't double count.
- The letter is always drafted from server-side findings (re-running the deterministic audit), never
  from client-supplied text.

## Deviations from the spec

- **Snippet highlighting, not boxes:** the confirm screen shows the cited page in a PDF preview and
  the verbatim snippet per field; drawing highlight boxes on the page image is not built.
- **Multi-entity documents** are refused with a message instead of being split (§4.2 step 1).
- **Out-of-network and coding-mismatch rules** are not in MVP 1 (spec lists them as optional/open).
- **Records are synthetic and shaped like our `VerbatimFact`,** not FinchNode's real schema; the live
  client is MVP 2 after the data-fit spike (§7.2). Rebuild fixtures around the real sandbox patient.
- **Uploaded files are kept in process memory** (private, no public links); durable private storage
  is an open decision. `/api/documents/[id]/file` has no auth yet.
- Prettier is installed but the codebase hasn't been bulk-formatted.

## Checks performed

- `npx tsc --noEmit`, `npx eslint .`, `npx vitest run` (42 passed), `npx next build`: all clean.
- End-to-end against `next start`: audit refused before confirmation; sample bill + EOB confirm;
  audit returns the 3 expected findings and verdict (billed $1,724.00, questioned $254.00); letter
  drafted (template, no key); PDF renders; balance statement → itemized-bill request; upload without
  a key returns `no_ai`.
- Browser check of start, confirm, audit, and letter screens (click-to-source works).

## Known limitations / unverified

- **Live Gemini extraction and drafting are untested** (no API key in this session). Run
  `npm run eval:extraction` first thing once a key is set.
- **Neon store is untested** (no `DATABASE_URL`); run `npx drizzle-kit push` then exercise the flow.
- PDF previews rendered dark in automated screenshots; confirm they display in a normal browser.
- Scanned-PDF and phone-photo eval variants still need to be created (print and photograph the
  sample bill).
