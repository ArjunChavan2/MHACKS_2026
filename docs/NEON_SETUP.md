# Neon setup for teammates

How to connect your local copy of the app to the team's Neon database. Written so you can hand it
to your coding agent ("Follow docs/NEON_SETUP.md"). The agent does every step except the ones
marked **You**: signing in through a browser and anything that needs your password.

Background: SPEC.md §4.6 (data), §5.1 (stack). What was built: `agent-notes/neon-setup/IMPLEMENTATION.md`.

## Facts

| Thing                 | Value                                                                                          |
| --------------------- | ---------------------------------------------------------------------------------------------- |
| Neon project ID       | `snowy-star-63367096`                                                                          |
| Neon branch           | `production` (the only branch so far)                                                          |
| Services in `neon.ts` | Postgres only                                                                                  |
| Schema                | `db/schema.ts`; migrations in `db/migrations/`                                                 |
| Secrets               | `.env.local` (gitignored). Never commit it or paste the connection string in chat or the repo. |

The tables already exist in Neon. **Don't run `npm run db:migrate` during setup** unless step 6
says tables are missing.

## Steps

1. **Node 22+.** Check with `node -v`. If it's missing, **You**: install it (for example
   `nvm install 22`) in a normal terminal.
2. **Dependencies.** From the repo root, on an up-to-date `main`: `git pull && npm ci`.
3. **Neon access.** The project is shared with each teammate's email (Mateo did this for
   `spereddy@`, `akchavan@`, and `esthem@umich.edu` on 2026-10-03). **You**: sign in to
   [console.neon.tech](https://console.neon.tech) with that exact email (sign up with it if you
   have no Neon account); the project "Bil-less" appears under **Shared with me**. Someone else?
   Ask Mateo to add your email in the project's Settings → Sharing. Skip this step if you're taking
   the connection string instead (step 5, option B).
4. **Neon CLI + sign-in.** **You** run these in a terminal (they open a browser):
   ```bash
   npm i -g neon@latest
   neon auth            # sign in with the email the project is shared with
   ```
5. **Get `DATABASE_URL` into `.env.local`.** Pick one:
   - **A (preferred):** `neon link --project-id snowy-star-63367096 --branch production -y`.
     This writes `DATABASE_URL`, `DATABASE_URL_UNPOOLED`, and `NEON_BRANCH` to `.env.local` and
     creates `.neon/` (gitignored).
   - **B:** get the pooled connection string from Mateo privately, then
     `cp .env.example .env.local` (if you don't have one) and set `DATABASE_URL=` in it.
     Keep your `GEMINI_API_KEY` line in `.env.local` if you already had one.
6. **Verify.** `npm run db:check`. Expected output ends with `Neon OK.` It writes and deletes one
   throwaway synthetic case. If it says tables are missing, run `npm run db:migrate`, then
   `npm run db:check` again.
7. **Try the app.** `npm run dev`, click "Sample bill + EOB", confirm, run the audit, draft the
   letter, then reload the page: the URL has `?case=…` and the case comes back from Neon.
8. **Optional: Neon skills and MCP for your agent.** Run them yourself in a terminal (they change
   your agent's settings):
   ```bash
   neon skills --agent claude-code -y      # already committed in .claude/skills/, usually not needed
   neon mcp --agent claude-code --oauth -y # Neon MCP server; --oauth stores no API key
   ```
   Replace `claude-code` with your agent (`cursor`, `codex`, `vscode`, …). Restart the agent afterwards.

## Changing the schema

1. Edit `db/schema.ts` (with docstrings, SPEC.md §5.5).
2. `npm run db:generate` creates a new SQL file in `db/migrations/`. Read it.
3. `npm run db:migrate` applies it to Neon. **Everyone shares one database**, so tell the team
   before you migrate, and never edit or delete a migration that's already on `main`.
4. Commit the schema change and the migration together. `npm test` runs every migration on an
   in-process Postgres (PGlite), so a broken migration fails the tests.

Other commands: `npm run db:studio` (browse data), `npm run db:check` (health check).

## Problems we hit and fixes

| Symptom                                                                                  | Fix                                                                                                                                                    |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `node: command not found`                                                                | Node isn't installed in WSL. Step 1.                                                                                                                   |
| Claude Code auto mode refuses `npm i -g neon` or `neon …` ("Untrusted Code Integration") | Expected. Run the command yourself, in a normal terminal or with the `!` prefix in Claude Code (it must be the first character).                       |
| `!` command "does nothing"                                                               | The `!` wasn't the first character, or a long line got broken when pasted. Use a normal terminal.                                                      |
| `No coding agents detected in this project`                                              | Add `--agent claude-code` (or your agent's name), or drop `-y` to pick from a list.                                                                    |
| `Authentication required. Run neon auth`                                                 | Run `neon auth` and sign in with the email the project is shared with.                                                                                 |
| `neon link` can't find `snowy-star-63367096`                                             | You're signed in with a different email than the one it's shared with. `neon auth` again with the right one, or ask Mateo to share it with this email. |
| `neon config init` asks which services to declare                                        | Press Enter: Postgres only. Other services are team decisions (SPEC.md §12).                                                                           |
| `DATABASE_URL is not set` from `db:check`                                                | `.env.local` is missing the line. Step 5.                                                                                                              |
| App works but data disappears on restart                                                 | `DATABASE_URL` isn't set, so the app fell back to the in-memory store. Step 5, then restart `npm run dev`.                                             |
