#!/usr/bin/env bash
# One-command local setup for teammates and their coding agents (docs/NEON_SETUP.md).
#
# Does everything that needs no human: checks Node, installs dependencies, links the team's Neon
# project (if the Neon CLI is signed in), creates .env.local, and verifies the database.
# Safe to re-run; it never overwrites a DATABASE_URL that is already set.
#
# Exit codes: 0 = ready. 1 = something failed (message says what). 2 = a human must do one thing
# (printed under "ACTION NEEDED"), then re-run `npm run setup`.
set -uo pipefail
cd "$(dirname "$0")/.."

PROJECT_ID="snowy-star-63367096"
NEON_BRANCH="production"
ENV_FILE=".env.local"

say() { printf '\n== %s\n' "$*"; }
need_human() {
  printf '\nACTION NEEDED (a person must do this, then re-run: npm run setup)\n%s\n' "$*"
  exit 2
}
# Prints the value of KEY in .env.local (empty if missing or blank).
env_value() { [ -f "$ENV_FILE" ] && grep -E "^$1=" "$ENV_FILE" | tail -1 | cut -d= -f2- | sed -E 's/[[:space:]]*#.*$//; s/^"(.*)"$/\1/' || true; }

say "1/5 Node"
if ! command -v node >/dev/null 2>&1; then
  need_human "Node.js is not installed. Install Node 22+ (e.g. https://github.com/nvm-sh/nvm, then: nvm install 22)."
fi
major="$(node -p 'process.versions.node.split(".")[0]')"
[ "$major" -ge 22 ] || need_human "Node $(node -v) is too old. Install Node 22+ (nvm install 22)."
echo "node $(node -v)"

say "2/5 Dependencies (npm ci)"
npm ci --no-audit --no-fund >/dev/null || { echo "npm ci failed; run it directly to see why."; exit 1; }
echo "installed"

say "3/5 Database connection string"
if [ -n "$(env_value DATABASE_URL)" ]; then
  echo "DATABASE_URL already set in $ENV_FILE"
else
  echo "Linking Neon project $PROJECT_ID ($NEON_BRANCH) with the Neon CLI..."
  if npx -y neon@latest link --project-id "$PROJECT_ID" --branch "$NEON_BRANCH" -y >/tmp/neon-link.$$ 2>&1; then
    echo "linked"
  else
    if grep -qi "auth" /tmp/neon-link.$$ && [ -t 0 ] && [ -t 1 ]; then
      echo "Not signed in to Neon; opening the sign-in (use the email the project is shared with)..."
      npx -y neon@latest auth && npx -y neon@latest link --project-id "$PROJECT_ID" --branch "$NEON_BRANCH" -y >/dev/null 2>&1 && echo "linked"
    fi
  fi
  rm -f /tmp/neon-link.$$
fi

# Create .env.local from the template if linking didn't, and drop blank duplicates of keys.
[ -f "$ENV_FILE" ] || cp .env.example "$ENV_FILE"
for key in DATABASE_URL DATABASE_URL_UNPOOLED GEMINI_API_KEY; do
  if [ "$(grep -cE "^$key=" "$ENV_FILE")" -gt 1 ]; then
    sed -i.bak -E "/^$key=[[:space:]]*(#.*)?$/d" "$ENV_FILE" && rm -f "$ENV_FILE.bak"
  fi
done

if [ -z "$(env_value DATABASE_URL)" ]; then
  need_human "No DATABASE_URL yet. Do ONE of these:
  A) In a normal terminal run:  npx neon@latest auth
     and sign in with the email the Neon project is shared with (ask Mateo to share it if needed).
  B) Ask Mateo privately for the connection string and paste it into $ENV_FILE as:
     DATABASE_URL=postgresql://...
Never commit $ENV_FILE or paste the string in the repo or a group chat."
fi

say "4/5 Verify Neon"
npm run --silent db:check || { echo "Database check failed (see above). Wrong or expired DATABASE_URL?"; exit 1; }

say "5/5 AI keys (optional)"
if [ -n "$(env_value XAI_API_KEY)" ] || [ -n "$(env_value GEMINI_API_KEY)" ]; then
  [ -n "$(env_value XAI_API_KEY)" ] && echo "XAI_API_KEY set: real uploads use Grok by default"
  [ -n "$(env_value GEMINI_API_KEY)" ] && echo "GEMINI_API_KEY set: LLM_PROVIDER=gemini uses Gemini"
else
  echo "No AI key: the sample bill flow works; real uploads need XAI_API_KEY (console.x.ai) or"
  echo "GEMINI_API_KEY (https://aistudio.google.com/apikey) in $ENV_FILE"
fi

say "Ready. Start the app with: npm run dev"
