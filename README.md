# MHACKS_2026

MHacks 2026: a patient-side agent that works a medical bill case from the itemized bill to a
documented outcome (and a cross-provider denial appeal as a stretch), powered by FinchNode records.

**Start here: [SPEC.md](SPEC.md)**, the single source of truth (build plan in §6).

## Run it (MVP 1)

```bash
npm install
cp .env.example .env.local   # add GEMINI_API_KEY to read your own uploads; optional DATABASE_URL
npm run dev                  # http://localhost:3000
```

Without a Gemini key, use **"Sample bill + EOB"** on the start screen: synthetic documents read from
saved answers, labeled in the UI, with the same checks as a live upload.

The frontend follows the approved [Paper desktop/mobile designs](https://app.paper.design/file/01M428RCW5T1N8D1HWKY3RW9RJ/01K4GP58P8JRM8PGBP0586VKYV):
responsive evergreen styling, evidence-linked findings, and a no-findings state. The same design
language covers upload, confirmation, and draft review. See
[frontend integration notes](agent-notes/mvp1-paper-frontend/IMPLEMENTATION.md) for scope and validation.

| Command                   | What it does                                                              |
| ------------------------- | ------------------------------------------------------------------------- |
| `npm test`                | Vitest suite                                                              |
| `npm run typecheck`       | TypeScript check                                                          |
| `npm run lint`            | ESLint                                                                    |
| `npm run fixtures`        | Regenerate the synthetic PDFs, expected model replies, and records        |
| `npm run eval:extraction` | Live Gemini extraction eval against the fixtures (needs `GEMINI_API_KEY`) |
| `npx drizzle-kit push`    | Create the tables in Neon (needs `DATABASE_URL`)                          |
