<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

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
