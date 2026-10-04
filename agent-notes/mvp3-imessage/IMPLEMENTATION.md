# IMPLEMENTATION: mvp3-imessage

Status: **steps 2–6 and 8 done; step 1 (Photon spike) half done; step 7 replaced by a
deterministic match.** Everything except a real iMessage round trip is built and tested. The real
round trip needs `PHOTON_PROJECT_ID` / `PHOTON_PROJECT_SECRET`, which nobody has yet.

## What changed

| File | What |
|---|---|
| `lib/messaging/index.ts` | Pure core: `parseReply`, `composeUpdate`, `composeStatus`, `composeWhy`, `composeHelp`, `decideNotify`, `notifySnapshotOf`, `resolvePrompt`, `matchFinding`, `newLinkCode`, `fit` |
| `lib/messaging/service.ts` | `handleInbound(handle, text, baseUrl)`, `pendingOutbox(baseUrl)`, `ack(messageId)`, `imessageStatus(caseId)` |
| `lib/messaging/auth.ts` | Bearer `MESSAGING_SECRET` check (constant time; 503 when unset); `publicOrigin` (APP_URL or request origin) |
| `lib/cases/store.ts` | `findCasesByEvent(type, match)` on memory and Postgres (`data->>key = $v`, no schema change) |
| `lib/cases/caseflow.ts` | Timeline wording for `imessage_linked/unlinked/sent/reply`; bookkeeping events hidden |
| `app/api/messaging/{inbound,outbox,ack}` | Worker-only routes |
| `app/api/cases/[id]/imessage` | Case screen panel data: link code (created on first GET), linked flag, `PHOTON_NUMBER` |
| `app/_components/CaseScreen.tsx` | "iMessage updates" panel under the card (link code, or "Linked to iMessage") |
| `workers/photon/index.ts` | Spectrum worker + `--local <handle>` terminal mode; `npm run worker:photon` |
| `package.json` | `@spectrum-ts/core` + `@spectrum-ts/imessage` 12.10.1 (lean install instead of `spectrum-ts`, which also pulls Slack/Telegram/WhatsApp); `worker:photon` script |
| `tests/messaging/*.test.ts` | 32 tests: pure core, service end to end on memory and PGlite, route auth |

## Spike answers (step 1, from the SDK's type definitions; not yet run against Photon)

- **Credentials:** `Spectrum({ projectId, projectSecret, providers: [imessage.config()] })`; both come
  from the Photon dashboard. Still needed from Photon.
- **Proactive (first) message:** supported: `imessage(app).space.create(handle)` then
  `space.send(text)`. So the outbox can text first; no need for the replies-only fallback.
- **Sender handle:** `message.sender.id` (a `User.id`); the same string is passed to
  `space.create` for outbound, so both directions use one format. Unverified whether it's the
  phone number/email or an opaque ID; confirm on the first real message.
- **Recipient limits:** not in the types; ask Photon.
- **Go/no-go on iMessage:** pending credentials (SPEC.md §7 O3).

## Important decisions

- **The worker is transport only.** It posts `{ handle, text }` to `/api/messaging/inbound` and
  sends back `reply`; polls `/api/messaging/outbox` every 3 s, sends, then acks. It can restart or
  move hosts without losing state.
- **Approvals:** "A" approves only the latest `imessage_prompt`, only if not done/expired (24 h) and
  still the card's exact allowed action + target, and runs it through `runCaseAction(…, approve: true)`,
  the same gate as the web button. Stale, expired, duplicate, or missing prompts are refused with
  the current card; nothing runs.
- **Every text is written by code.** Updates are the machine's card text; "why" answers are the
  finding's `title`, `statusNote`, `explanation`, then `describeSource` citations. A unit test
  asserts every line of a "why" answer is one of those strings.
- **Handles are stored only in `imessage_linked` / `imessage_unlinked` events**; reply events record
  the intent and result, not the handle or body. Worker logs mask handles (`…34`) and log lengths only.
- **Outbox dedupe:** a pending update is reused while the state is unchanged, superseded when it
  changes, and dropped when a reply already delivered that state (the reply records
  `imessage_notified` too). A restarted worker sends only the latest card per case.

## Deviations from the plan

- **Text limit 1000, not ~600.** The documentation-gap explanation alone is ~480 characters, so 600
  dropped the Northstar record citation, which is the point of the "why" answer. Sources are also
  ordered records first. Lines are never cut; overflow becomes "(N more in the app)" + link.
- **Step 7 without a model.** Free-text "why …" picks the finding by word overlap with finding
  titles (`matchFinding`), falling back to the card's finding. Deterministic, so no validation
  layer is needed. An LLM picker can still be added later.
- **`notifySnapshotOf` instead of `snapshotOf`** (caseflow already exports a `snapshotOf`), and
  `decideNotify(prev, view)` without `today` (the card's `overdue` already uses today).
- **`composeStatus` returns `{ text, prompt? }`** so "A" also works after STATUS.
- **Local test mode in the worker** (`--local <handle>`) instead of Spectrum's terminal provider:
  no extra dependency, and it exercises the same app routes.

## Known limitations

- No real iMessage round trip yet (needs Photon credentials).
- Inbound and outbox are not transactional: an inbound reply and an outbox poll at the same moment
  could both send the same card. Harmless (same text) and unlikely with one demo phone.
- `GET /api/cases/[id]/imessage` creates the link code on first read (a write on GET), keyed only
  by the unguessable case ID, like the other case routes until login exists.
- Two phones linked to one case both get updates and either can approve (demo simplicity).
- `MESSAGING_SECRET` must be added to Vercel before the deployed app accepts the worker.

## How to run

```bash
# .env.local: MESSAGING_SECRET (any long random string), APP_URL, and for iMessage PHOTON_PROJECT_ID/SECRET
npm run dev                                         # app on :3000
npm run worker:photon -- --local +15555550123       # type LINK <code>, STATUS, A, B, WHY, STOP
npm run worker:photon                               # real iMessage via Photon
```

The case screen shows the link code ("Text LINK 8SZYRX to …").

## Checks performed

- `npm test`: 123 passed (32 new). `tsc --noEmit`, `eslint` on changed files, and `next build`
  are clean.
- Manual run: dev server (memory store) + worker in `--local` mode. Unknown handle → link
  instructions; LINK → card with "Reply A"; WHY; A → dispute sent through the approval gate;
  second A → "Already done"; operator response → exactly one outbox update, sent and acked; free-text
  "why was the free T4 flagged?" → quotes Northstar's 2026-03-02 record verbatim; STATUS → numbered
  issues; STOP → unlinked. Timeline shows the iMessage events in plain words.
