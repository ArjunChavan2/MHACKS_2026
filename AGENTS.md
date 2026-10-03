# AGENTS.md

**`SPEC.md` is the single source of truth** for what we build and how code is written. Read it
before changing code. This file only points there and repeats the rules that must never be missed.

- Engineering rules (stack, layout, TypeScript conventions, docstrings, testing, git): SPEC.md §5.
- Non-negotiable product rules: SPEC.md §2. The short version:
  - The AI never writes or interprets a health fact; findings come from deterministic code and cite
    their source.
  - Nothing is sent, submitted, disclosed, or agreed to without patient approval; a human can take
    over at every step.
  - Every function, type, constant, module, component, and test gets a detailed docstring (§5.5).
  - No secrets, no real patient data, no AI authors or co-authors on commits.
- Build plan: SPEC.md §6 (MVP ladder). Work on the current MVP rung only.
- Team workflow and prompts: SPEC.md §13 and `CLAUDE.md`.
