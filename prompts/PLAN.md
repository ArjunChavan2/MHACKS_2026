# Planning Agent

Your job is to understand the task and produce a concrete implementation plan.

**Do not implement the solution in this session.**

## Repository conventions

- Reusable agent instructions live in `prompts/`.
- Persistent outputs and handoff notes live in `agent-notes/<task>/`, one folder per task
  (e.g. `agent-notes/finchnode-sync/`), because several developers run phases in parallel. Use the
  task name you were given; if none was given, ask for one.
- Do not modify files in `prompts/`.
- Write this phase's output to `agent-notes/<task>/PLAN.md`.

## Project context

This repository is an MHacks 2026 hackathon project (24 hours, 4 developers): a FinchNode-powered
medical bill auditor and patient advocate (bill audit + evidence-backed denial appeals,
with drafted letters, phone calls, and text updates). Single source of truth: `SPEC.md` (rules §2, engineering rules §5, MVP ladder §6). Known pitfalls: `CLAUDE.md`.

- **Core invariant — AI never writes a health fact or invents a finding.** Health facts are copied
  verbatim from FinchNode records with their source attached; an LLM never writes, summarizes, or
  infers them. Bill-audit flags and appeal evidence come from deterministic rules and cite their
  bill line, EOB line, or record. The AI only does paperwork and conversation (extraction the
  patient confirms, letter/script prose, voice calls), and nothing is sent or agreed to without the
  patient's approval. See
  `SPEC.md` §2 for the full rule. Any plan that routes a health fact through an LLM is wrong.
- Other developers are working on other tasks at the same time. Check other
  `agent-notes/*/PLAN.md` files and the repository for interfaces you depend on or would touch, and
  keep your task's footprint inside its own files where practical.
- Plan only within the current MVP rung in `SPEC.md` §6; the result must keep the previous rung's
  demo working.
- This is a 24-hour hackathon. Prefer the simplest thing that demos reliably on the FinchNode
  synthetic sandbox over production completeness.

## Before you begin

1. Read `SPEC.md`, `CLAUDE.md`, and any other relevant documentation.
2. Inspect the repository structure and relevant source files.
3. Read other tasks' `agent-notes/*/PLAN.md` for shared interfaces.
4. Understand the existing implementation before proposing changes.

## Goals

1. Identify the actual problem to solve.
2. Extract the required behavior, interfaces, constraints, invariants, and acceptance criteria.
3. Identify dependencies between components, including other developers' tasks.
4. Identify important edge cases and failure modes.
5. Avoid the **X/Y problem**:
   - distinguish the user's actual goal from a proposed implementation
   - do not assume a suggested approach is required unless the specification requires it
6. Identify uncertainties, missing information, and risky assumptions (especially unverified
   FinchNode API behavior).
7. Propose the simplest reasonable architecture that satisfies the requirements.
8. Break the work into small, ordered implementation steps.
9. Identify how the major requirements can later be independently verified.

## Output

Write the final plan to:

`agent-notes/<task>/PLAN.md`

The plan should contain:

- **Goal**
- **Relevant requirements**
- **Repository observations**
- **Proposed architecture**
- **Interfaces and data flow** (including contracts shared with other tasks)
- **Implementation steps**
- **Edge cases and failure modes**
- **Open questions and assumptions**
- **Verification strategy**

## Rules

- Do not modify implementation code.
- Do not begin implementing while planning.
- Prefer evidence from the specification and repository over assumptions.
- Do not invent requirements. Items marked *Open* in the spec are not requirements.
- Keep scope limited to what the specification requires.
- Make the plan specific enough that a fresh implementation agent can execute it without relying
  on this conversation history.
