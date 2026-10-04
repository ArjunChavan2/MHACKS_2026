# HANDOFF.md — session handoff (2026-10-03)

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

## State right now

- **MVP 1 (cited bill audit) is built** with the MVP 0 pieces it needs: see
  `agent-notes/mvp1-bill-audit/IMPLEMENTATION.md`. 42 tests pass; build, lint, and types are clean.
  Live Gemini and Neon are untested (no keys yet). Next for MVP 1: run the audit and test phases.
- SPEC.md (including the full extraction spec in §4.2) is complete through: product, rules, agent model, capabilities, engineering rules and
  docstrings, MVP ladder (MVP 0–6), obstacle register (O1–O13) with the call orchestrator design
  (§7.1) and FinchNode data-fit plan (§7.2), demo plan, prize targets, research, open decisions.
- **Neon wiring is on branch `Neon`** (`agent-notes/neon-setup/IMPLEMENTATION.md`): migrations in
  `db/migrations/`, files persisted in Neon, `npm run db:migrate` / `db:check`, PGlite tests.
  Live and verified on Neon project `snowy-star-63367096` (branch `production`); merge to `main`.
  Teammates: `neon login`, `neon link --project-id snowy-star-63367096 --branch production -y`
  to get `.env.local`, or ask for the connection string.
- Audit and test prompts were just updated with the agent-core checks (three outcome branches,
  waiting and resuming, verification, assertion-is-not-proof, binding constraints, labeling).

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
