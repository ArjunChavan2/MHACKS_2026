# PLAN: mvp3-imessage

Planning phase output (`prompts/PLAN.md`). Nothing here is implemented yet.

## Goal

The patient runs the MVP 2 case from iMessage (SPEC.md §4.8, §6 MVP 3, Photon prize): they get a
text when the case needs them or something changes, approve the next step by replying **A** (or hold
with **B**), and ask **"why?"** about any flagged charge and get an answer built from the finding's
own text and citations. It must be a real two-way exchange over **Photon Spectrum on iMessage** to
qualify. The web case screen keeps working exactly as today; iMessage is a second front end to the
same case actions.

Demo (SPEC.md §6): the MVP 2 story where "Approve sending the dispute letter", the billing office's
response, the "waiting for the lab" update, and "why was the free T4 flagged?" all happen in
iMessage on a teammate's phone, while the operator console plays the office.

## Relevant requirements

- §2 core rule: **no health fact is written by an LLM.** Every message is composed by code from the
  case state (`state.next`, findings, sources). "Why?" answers quote the finding's template text and
  its sources verbatim (`describeSource`). An LLM may only *pick* which finding a free-text question
  refers to, from a list of IDs; it never writes the reply.
- §4.7 approval gate: an "A" reply is the patient's approval only for the exact action and target the
  prompt named, and only if that action is still allowed. Anything else is refused with the latest
  status.
- §4.8: updates on new blockers and next steps; A/B approvals mapped to case actions; deadline/overdue
  reminders; grounded "why?" answers; unknown, late, and duplicate replies handled; must use Spectrum
  on iMessage.
- §6 MVP 3 exit criteria: replies route to the right case and action; duplicate/late/unknown replies
  handled; answers contain no health facts beyond verbatim citations. *If behind:* updates plus the
  "why?" answer (keep it two-way).
- §7 O3: Photon setup is self-serve (no Photon engineer on site); build against Spectrum's local or
  terminal mode until iMessage credentials work; go/no-go on iMessage access early.
- Out of scope: mid-call choices over iMessage (MVP 4 uses this later), Neon Auth, real phone-number
  verification.

## Repository observations

- Case API (MVP 2, `agent-notes/mvp2-adaptive-case/IMPLEMENTATION.md`):
  - `GET /api/cases/[id]` → `view.state`: `phase`, `next` (the "What happens next?" card: `actionId`,
    `title`, `why`, `needed`, `responsibleParty`, `deadline`, `overdue`, `needsApproval`, `target`,
    `citedFindingIds`), `allowed`, `tasks`, `savings`, `timeline`. `view.audit.findings` holds each
    finding's `title`, `explanation`, `statusNote`, `sources`, `statusSources`.
  - `POST /api/cases/[id]/actions { actionId, target?, approve? }` runs `send_dispute`,
    `request_document`, `request_revised_statement`, `follow_up`, `patient_takes_over`; refuses with
    409 when not allowed. Approvals are recorded as `approval_recorded` events.
  - Everything persists as case events (`case_events`), so no migration is needed for new event types.
- `lib/cases/caseflow.ts` (`runCaseAction`, `caseStateOf`), `lib/cases/store.ts` (`CaseStore` with
  `addEvent`, `getCase`; memory + Neon + PGlite tests), `app/_components/sources.ts`
  (`describeSource`, plain text, safe to reuse server-side).
- Deploy: Vercel (`https://mhacks-2026.vercel.app`, `https://billless.tech`), Neon shared DB. Vercel
  functions can't hold Photon's long-lived connection (SPEC.md §5.1: "Vercel can't host it").
- Photon `spectrum-ts` (MIT, `npm i spectrum-ts`): persistent gRPC stream to Photon in both
  directions, **no webhook or public URL**. Example from the docs:
  ```ts
  import { Spectrum } from "spectrum-ts";
  import { imessage } from "spectrum-ts/providers/imessage";
  const app = await Spectrum({ projectId: process.env.PROJECT_ID, projectSecret: process.env.PROJECT_SECRET, providers: [imessage.config()] });
  for await (const [space, message] of app.messages) {
    await space.responding(async () => { await message.reply("Hello from Spectrum."); });
  }
  ```
  Docs: https://docs.photon.codes/spectrum-ts/getting-started and
  https://photon.codes/docs/spectrum-ts/providers/imessage (cloud `@spectrum-ts/imessage`, local
  `@spectrum-ts/imessage-local`). **Not confirmed from the docs:** how to send the *first* message to
  a handle (outbound without an incoming message), how to obtain `projectId`/`projectSecret`, and any
  recipient limits. Step 1 is a spike to confirm these.

## Proposed architecture

Thin transport, server-side brain:

```
iPhone (iMessage) ⇄ Photon ⇄ workers/photon (Node, laptop or Railway; spectrum-ts stream)
                                   │  HTTPS + shared secret
                                   ▼
                    Vercel API: /api/messaging/*  →  lib/messaging (pure)  →  lib/cases (MVP 2)
```

1. **`workers/photon/` (transport only).** Holds the Spectrum connection. On an incoming message it
   posts `{ handle, text }` to `POST /api/messaging/inbound` and sends back the returned `reply`.
   Every few seconds it calls `GET /api/messaging/outbox` and sends each queued message, then
   acknowledges it. No case logic lives in the worker, so it can restart or move hosts freely.
2. **`lib/messaging/` (pure, tested).** Parses replies into intents, composes every message from
   case state with templates, decides when a change deserves a text, and resolves which prompt an
   "A"/"B" answers.
3. **API routes on Vercel** (worker-only, `Authorization: Bearer $MESSAGING_SECRET`):
   `/api/messaging/inbound`, `/api/messaging/outbox`, `/api/messaging/ack`. They load cases, call
   `lib/messaging`, run actions through the existing `runCaseAction`, and store events.
4. **Linking a phone to a case.** The case screen shows "Get updates on iMessage: text `LINK 4F7K2Q`
   to <Photon number>". The code is generated per case (`imessage_link_code` event). The first
   `LINK <code>` from a handle links it (`imessage_linked { handle }`); one active case per handle
   (latest link wins; `STOP` unlinks).
5. **When to text** (`decideNotify(previous, current)`): the `next` card changed (different
   `actionId`/`target`), a new counterparty response was recorded, savings became confirmed, a task
   became overdue, or the case resolved. Not on every event. The last notified snapshot is stored as
   an `imessage_notified` event so restarts don't resend.
6. **Approvals by reply.** When the card `needsApproval` and is runnable, the update ends with
   "Reply A to approve, B to hold, or WHY". That creates an `imessage_prompt { promptId, actionId,
   target, expiresAt }` event. "A" runs `runCaseAction(caseId, { actionId, target, approve: true })`
   only if that prompt is still the latest and the action is still allowed; otherwise it replies
   that the choice expired and sends the current card.
7. **"Why?" answers.** `WHY` (or "why", "why was X flagged?") answers about the card's
   `citedFindingIds[0]`; `WHY 2` picks the second issue in the list sent with `STATUS`. The reply is
   the finding's `title`, `statusNote` (if any), `explanation`, and its sources through
   `describeSource`, trimmed to iMessage length, plus the case link. Free text that isn't a command:
   optionally ask the model to choose one finding ID from the case's list (validated against the
   list; fall back to the card's finding); otherwise reply with HELP.

## Interfaces and data flow

### Commands (case-insensitive, trimmed)

| Reply | Meaning |
|---|---|
| `LINK <code>` | Link this handle to the case with that code |
| `A` / `YES` / `APPROVE` | Approve the latest open prompt |
| `B` / `NO` / `HOLD` | Decline the latest open prompt (logged, nothing runs) |
| `WHY`, `WHY <n>`, or a question containing "why" | Grounded explanation of a finding |
| `STATUS` | Current card plus numbered list of open issues and the savings trio |
| `STOP` | Unlink this handle |
| `HELP` or anything else | Short list of commands + case link |

### `lib/messaging` (pure)

```ts
type Intent =
  | { kind: "link"; code: string } | { kind: "approve" } | { kind: "decline" }
  | { kind: "why"; index?: number; question?: string } | { kind: "status" } | { kind: "stop" } | { kind: "help" };
parseReply(text: string): Intent;
composeUpdate(view: CaseView, caseUrl: string): { text: string; prompt?: { actionId; target? } };
composeWhy(view: CaseView, findingId: string, caseUrl: string): string;   // template + describeSource only
composeStatus(view: CaseView, caseUrl: string): string;
decideNotify(prev: NotifySnapshot | null, view: CaseView, today: IsoDate): boolean;
snapshotOf(view: CaseView): NotifySnapshot;   // { actionId, target, responses, confirmedCents, overdue, phase }
resolvePrompt(prompts: ImessagePrompt[], view: CaseView, now: Date): { ok: true; prompt } | { ok: false; reason: "none" | "expired" | "stale" | "done" };
newLinkCode(): string;   // 6 chars, no lookalikes (no 0/O/1/I)
```

### Events (stored on the case; no migration)

`imessage_link_code { code }`, `imessage_linked { handle }`, `imessage_unlinked { handle }`,
`imessage_prompt { promptId, actionId, target?, expiresAt }`, `imessage_reply { handle, intent,
promptId?, result }`, `imessage_notified { snapshot, messageId }`, `imessage_outbox { messageId,
text }` / `imessage_sent { messageId }`. The case timeline shows linked, sent, and reply events in
plain words (extend `summarize` in `caseflow.ts`).

### Store addition

`findCasesByEvent(type: string, match: Record<string, string>): Promise<string[]>`: memory store
scans; Neon store queries `case_events` where `type = $1` and `data->>key = $2` (no schema change).
Used to find a case by link code and by handle.

### API (worker-only, Bearer `MESSAGING_SECRET`)

- `POST /api/messaging/inbound { handle, text }` → `{ reply: string }` (always a reply, never throws
  to the worker; errors become "Something went wrong; open your case: <link>").
- `GET /api/messaging/outbox` → `[{ messageId, handle, text }]`: computed on read for every linked
  case (`decideNotify` against the last `imessage_notified`), stored as `imessage_outbox`.
- `POST /api/messaging/ack { messageId }` → marks sent (`imessage_sent`) and records the snapshot.

### Web UI

Case screen: an "iMessage updates" panel with the link code and instructions, and "Linked to iMessage"
once linked. No other UI changes.

### Env

`MESSAGING_SECRET` (Vercel + worker), `PHOTON_PROJECT_ID`, `PHOTON_PROJECT_SECRET` (worker only),
`APP_URL` (worker: which deployment to call), `PHOTON_NUMBER` (shown on the case screen).

## Implementation steps

1. **Spike (first, ≤1 h) [Dev 4]:** Photon credentials; run the docs example on iMessage from a
   laptop; confirm (a) how to send a message to a handle without an incoming message, (b) what
   `message` exposes for the sender handle, (c) any recipient limits. Record answers in
   `IMPLEMENTATION.md`. If proactive sends aren't possible, updates go out only as replies (the
   patient texts `STATUS`), which still satisfies a two-way exchange. Go/no-go on iMessage by the
   end of the spike (SPEC.md §7 O3).
2. **`lib/messaging` pure functions + tests [Dev 3]:** parser, composers, `decideNotify`,
   `resolvePrompt`, link codes. Tests use the Priya demo case (`tests/helpers.ts`) and the MVP 2
   branches.
3. **Store method + messaging service [Dev 3/4]:** `findCasesByEvent` (memory, Neon, PGlite test);
   `lib/messaging/service.ts` with `handleInbound(handle, text)`, `pendingOutbox()`, `ack(messageId)`.
4. **API routes [Dev 4]:** the three worker routes with the shared secret; route tests on the memory
   store.
5. **Worker [Dev 4]:** `workers/photon/index.ts` (+ `npm run worker:photon`), env above, reconnect on
   stream errors, outbox poll every 3 s, logs without message bodies.
6. **Case screen panel [Dev 2]:** link code and linked state.
7. **Optional free-text "why" routing [Dev 3]:** model picks a finding ID from the list; validated;
   falls back to the card's finding.
8. **Docs:** SPEC.md §6 status, HANDOFF.md (how to run the worker, where it runs during judging),
   CLAUDE.md known errors, `IMPLEMENTATION.md`.

*If behind:* skip step 7 and proactive outbox; keep `LINK`, `STATUS`, `WHY`, and `A`/`B` as replies.

## Edge cases and failure modes

- `A` with no open prompt → "Nothing is waiting for your approval" + current card.
- `A` after the case moved on (prompt target ≠ current card, or action no longer allowed) → refused,
  "That choice is no longer available", current card; no action runs.
- Duplicate `A` (second one after success) → "Already done" (prompt marked done); no second send.
- `A` after the prompt expired (e.g. 24 h) → treat as stale.
- `B` → logged as declined; the card stays; no reminder spam (wait for a state change).
- Unknown handle (not linked) → reply with how to link; never reveal anything about any case.
- Wrong or reused link code → "That code didn't match a case".
- Two phones linked to one case → both get updates; approvals from either count (demo simplicity;
  note it).
- Worker offline → outbox accumulates; on restart only the latest card per case is sent (dedupe by
  snapshot), not a backlog.
- Long texts → trim to ~600 characters and add the case link for details.
- A reply arrives while a web approval already ran → stale handling above.
- Photon credentials missing → worker exits with a clear message; web flow unaffected.
- No health facts beyond citations: composers only use `title`, `explanation`, `statusNote`, `ask`,
  `letterText`-free card text and `describeSource` output; a unit test asserts every `why` reply
  is built only from those strings.
- Privacy: handles are personal data. Synthetic cases only; never log message bodies or handles in
  plain text in worker logs; store the handle only in the link event.

## Open questions and assumptions

- **Unverified (spike):** proactive outbound sends, credential flow, sender handle field, limits.
- **Hosting during judging:** laptop on venue Wi-Fi vs Railway/Render (SPEC.md §12 item 7). Laptop is
  fine if it stays awake; decide at the spike.
- **Assumption:** one demo phone (a teammate's iPhone); no auth beyond the link code.
- **Assumption:** the worker calls the deployed app (`APP_URL`), so one database is the source of
  truth for web and iMessage.
- **Open:** whether reminders before deadlines are needed for the demo, or only overdue follow-ups
  (already surfaced as a card change).

## Verification strategy

- Unit: `parseReply` table tests (all commands, casing, extra words); `composeWhy` contains only the
  finding's strings and source descriptions; `decideNotify` fires once per card change and not on
  noise; `resolvePrompt` covers none/expired/stale/done/ok.
- Service on memory + PGlite: LINK → STATUS → A sends the dispute (approval recorded, `dispute_sent`)
  → duplicate A says already done → operator response → outbox has one update → WHY about the free T4
  quotes Northstar's record → STOP unlinks.
- Worker in Spectrum local/terminal mode before credentials; then one real iMessage round trip.
- Demo rehearsal on a phone against the deployed app, with the operator console running branches.
- Exit criteria from SPEC.md §6 MVP 3 checked one by one in `TEST_RESULTS.md`.
