# HANDOFF.md — session handoff (2026-10-03, updated night)

For the next Claude session (or teammate) picking up this project. **Read `SPEC.md` first; it is
the single source of truth.** This file only records where things live, what state they are in,
and what to do next. Delete or overwrite it when it goes stale.

## Where everything lives

| Thing | Location |
|---|---|
| Spec (source of truth) | `SPEC.md` in github.com/ArjunChavan2/MHACKS_2026 (private), local at `~/MHACKS_2026` |
| Pointer files | `AGENTS.md`, `CLAUDE.md`, `README.md` (all point to SPEC.md) |
| Workflow prompts | `prompts/PLAN.md`, `IMPLEMENT.md`, `AUDIT.md`, `TEST.md`; notes go in `agent-notes/<task>/` |
| Google Doc | "MHacks 2026", Drive ID `1S4FueYPu7byvy9Q3Qk__S0C31WRCCDMtkgiwihTp9xQ` |
| Official prizes | safe-banon-80d.notion.site/Tracks-Prizes-3ed24ca0c81b80579aeff03edfa88af5 and mhacks-2026.devpost.com |

### Google Doc tabs (IDs for the Docs API)

| Tab | ID | State |
|---|---|---|
| Demo Flow (archived) | `t.0` | Banner points to SPEC.md; team's original notes at top |
| Stack (archived) | `t.qe52mgz3jdvq` | Banner points to SPEC.md |
| MHacks Tracks | `t.3d1qb4hhwmi5` | Children: AI `t.ffy1bssfkmri`, FinTech `t.ocm5d4jc068g` |
| Sponsor Tracks | `t.9aovzmgjgc4o` | Children: FinchNode `t.746l1p3vsgtu` (official track + team notes), ElevenLabs, Photon, Neon, Fetch.ai, Notability, Capital One, Figma |
| MLH Prizes | `t.ec0l4hk4l2ca` | Children: MLH ElevenLabs, MLH Gemini, MLH .Tech |
| Side Quests | `t.bvrshi7236wv` | Child: Judged by an LLM |
| Competitors & Differentiation | `t.ii1512x7i419` | Team research; banner says summarized in SPEC.md |
| Muse Reel Research Review | `t.iezz9upvx5a6` | Team research; banner says summarized in SPEC.md |

The team deleted the tabs for tracks we skip. Formatting convention for anything added to the doc:
Michigan template copied from the user's EECS 445 write-up (headings Montserrat bold, blue
#00274C, maize #FFCB05 underline on H1; body Lato 10.5; light maize shading for banners).

## State right now (updated 2026-10-03 night)

Progress per rung is the Status column in SPEC.md §6.

- **MVP 1 (cited bill audit) is built** with the MVP 0 pieces it needs: see
  `agent-notes/mvp1-bill-audit/IMPLEMENTATION.md`. 91 tests pass; build, lint, and types are clean.
- **Frontend:** Sruthi integrated the Paper design into the bill audit UI (`ca9aab5`).
- **Live Gemini works.** `npm run eval:extraction` passes 334/334 fields across all 5 fixtures on
  `gemini-3.5-flash` (including the prompt-injection bill), now the pinned default; the
  `gemini-flash-latest` alias kept failing with 503/429. `gemini-2.5-flash` returns 404 for new keys.
- **Live FinchNode client built** (`lib/finchnode/live.ts`, `npm run finchnode:check`): with
  `USE_MOCK=false` it tries sandbox Connect, then FinchNode's demo API, then a saved snapshot, and the
  audit screen labels the origin. Sandbox Connect is stuck on FinchNode's side (no `subject`), so the
  demo API answers with 16 records from Northstar and Quillhaven.
- **Fixtures rebuilt around the FinchNode patient** (Priya Ramaswamy, synthetic): $321 Quillhaven bill
  with a duplicate TSH, $68 over the EOB, and a free T4 with no same-day record whose finding cites
  Northstar's free T4 from 3 days earlier. Mock mode serves FinchNode's saved records. Details in
  SPEC.md §7.2.
- **Letters read like letters now:** each finding carries a first-person `letterText` written by
  code; the model may only place `{{finding:<id>:letter}}` at the start of a sentence (else retry,
  then template); greeting and sign-off are added by code.
- **Deployed** (Vercel project `mhacks-2026`, team `bill-less1`, folder linked via `.vercel/`):
  production at **https://mhacks-2026.vercel.app** (redirect to the custom domain removed) and
  **https://billless.tech** once its DNS propagates (Namify registered it 2026-10-04 with Vercel
  nameservers; or add an A record `76.76.21.21` at Namify). Per-deployment `*-bill-less1.vercel.app`
  URLs require a Vercel login. Env vars set in Vercel: XAI_API_KEY, GEMINI_API_KEY, GEMINI_MODEL,
  DATABASE_URL(_UNPOOLED), NEON_BRANCH, FINCHNODE_API_KEY, USE_MOCK, FINCHNODE_CONNECT=off. Deploy:
  `npx vercel deploy --prod`. Live checks passed: full case flow on Neon, Grok upload 56/56 fields.
- **MVP 2 backend done** (`agent-notes/mvp2-adaptive-case/`): case state machine, approvals,
  three outcome branches, wait/resume, revised-statement verification, savings trio, timeline, and
  the `/api/cases/[id]/actions` and `/responses` endpoints. No DB migration (events). The case screen
  and the operator console (`/operator?case=…`, simulated billing office) are built and walked
  through in the browser. `?case=` links now resume cases (was broken).
- **Demo switch:** `FINCHNODE_CONNECT=off` skips the stuck sandbox Connect (no 45 s wait) and uses
  FinchNode's demo API directly.
- **Grok is now the default AI provider** (when `XAI_API_KEY` is set); Gemini stays for the judged
  demo (`LLM_PROVIDER=gemini`, MLH Gemini prize). Grok passes the extraction eval 334/334; PDFs are
  rendered to page images for it. Gemini's free tier is only 20 requests/day per project.
- **Fixed tonight** (`23b4728`): Gemini calls now time out (60 s) and retry overload, rate limits,
  dropped connections, and timeouts, then return API 503 `ai_busy`; the classifier no longer
  rejects EOBs by counting the insurer as a billing entity; code type is inferred from code format.
  Logged in CLAUDE.md "Known critical errors and fixes".
- **Neon is live** (`agent-notes/neon-setup/IMPLEMENTATION.md`): project `snowy-star-63367096`,
  branch `production`. All MVP 1 data persists (cases with status, documents, confirmed fields,
  findings, events, drafted letters, original files); `?case=<id>` reloads a case. Migrations in
  `db/migrations/` (`npm run db:migrate`, `db:check`). Teammates: `neon login`, then
  `neon link --project-id snowy-star-63367096 --branch production -y` to get `.env.local`.
  Full teammate guide: `docs/NEON_SETUP.md`.
  Next for MVP 1: run the audit and test phases, then start MVP 2.
- SPEC.md is complete through: product, rules, agent model, capabilities (full extraction spec in
  §4.2), engineering rules and docstrings, MVP ladder (MVP 0–6, with status), obstacle register
  (O1–O13) with the call orchestrator design (§7.1) and FinchNode data-fit plan (§7.2), demo plan,
  prize targets, research, open decisions.

## Next steps (in order)

1. **Get answers from the user** (SPEC.md §12): does the team know TypeScript (else move backend to
   Python), actual hacking start time and Devpost deadline, real names for Dev 1–4, teammates'
   GitHub usernames (then invite them as collaborators), whether to delete the archived doc tabs.
2. **Kick off the early spikes** (SPEC.md §6 MVP 0 and §7): FinchNode data fit (O5, Dev 1, by H3),
   Photon iMessage credentials (O3; Photon had no engineer on site, only a marketing officer, so
   setup is self-serve), call orchestrator spike (O1/O2).
3. **MVP 0 scaffold: mostly done as part of MVP 1** (remaining: real FinchNode data-fit fixtures,
   docstring/lint enforcement in CI). Original MVP 0 list: Next.js app, Neon + Drizzle schema per
   SPEC.md §4.6 relationships, `lib/types/` contract, `lib/llm/` Gemini smoke call,
   `lib/finchnode/` mock, fixtures v1, lint/Prettier/Vitest, `.env.example`.
4. **Write design docs** (offered, not started): call orchestrator (SPEC.md §7.1, with sequence
   diagrams), case state machine and allowed actions (`lib/cases/`), schema and shared types.
5. Run each task through the plan → implement → audit → test prompts (SPEC.md §13).

## Things the next session should know

- **User preferences:** never add Claude as author or co-author on commits; the home directory is
  itself a git repo, so always work inside `~/MHACKS_2026`; keep docstrings on everything.
- **The team edits the Google Doc live.** Index-based Docs API writes often fail on revision
  mismatch; prefer `replaceAllText` scoped with `tabsCriteria`, or re-read immediately before an
  index-based write. Full `read_doc` results are ~650 KB and get saved to a file; parse them with
  Python instead of reading them into context.
- **Do not overwrite the team's doc edits.** When the doc and SPEC.md disagree, ask which wins and
  record the decision in SPEC.md (doc-sync rule, SPEC.md top).
- **Recently added to SPEC.md (2026-10-03):** the full bill-extraction spec (§4.2: classify
  first, provenance on every field, text-layer cross-check, deterministic checks, confidence from
  checks, confirm screen, failure handling, traceability), the extraction test set and eval budget
  (§5.7), why Twilio and the Twilio trial plan (§5.1, §5.9), free-plan guidance (one stable account
  per service; don't create multiple trials with one provider to evade limits), call fallbacks
  (browser call, Relay) in §7, Gemini Live rejected (§5.1), medical-bill-decoder ideas (§4.4,
  §4.9, §5.7), the CNBC hook (§10), and product agents vs Claude skills (§5.11).
