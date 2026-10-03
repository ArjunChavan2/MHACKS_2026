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

- **No application code exists yet.** The repo has only the spec, pointers, prompts, and this file.
- SPEC.md is complete through: product, rules, agent model, capabilities, engineering rules and
  docstrings, MVP ladder (MVP 0–6), obstacle register (O1–O13) with the call orchestrator design
  (§7.1) and FinchNode data-fit plan (§7.2), demo plan, prize targets, research, open decisions.
- Audit and test prompts were just updated with the agent-core checks (three outcome branches,
  waiting and resuming, verification, assertion-is-not-proof, binding constraints, labeling).

## Next steps (in order)

1. **Get answers from the user** (SPEC.md §12): does the team know TypeScript (else move backend to
   Python), actual hacking start time and Devpost deadline, real names for Dev 1–4, teammates'
   GitHub usernames (then invite them as collaborators), whether to delete the archived doc tabs.
2. **Kick off the early spikes** (SPEC.md §6 MVP 0 and §7): FinchNode data fit (O5, Dev 1, by H3),
   Photon iMessage credentials (O3; Photon had no engineer on site, only a marketing officer, so
   setup is self-serve), call orchestrator spike (O1/O2).
3. **Scaffold MVP 0** (offered to the user, not started): Next.js app, Neon + Drizzle schema per
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
- **Discussed but intentionally not added to SPEC.md** (the user chose not to): Twilio trial
  details ($15 credit, verified numbers only, trial announcement and possible keypress, upgrade
  about $20 before judging); call fallbacks beyond hand-back (browser call, or Relay, which might
  also earn the Relay prize); Gemini Live considered and rejected for voice (lose ElevenLabs
  prizes, custom audio bridge); ideas from the `medical-bill-decoder` skill (verdict block,
  line-by-line table, three scripts; license unchecked); a CNBC 2026-10-01 article about an insurer
  blaming AI for ~$1B in questionable hospital charges (unread, possible hook). Ask before adding.
