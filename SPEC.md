# SPEC.md — single source of truth

**Project:** patient-side medical bill agent (working name). MHacks 2026, Oct 3–4, Ann Arbor.
4 developers, ~24 hours. Primary target: the FinchNode prize. Secondary: sponsor prizes (§9).

This file replaces `spec/PROJECT.md`, the engineering rules formerly in `AGENTS.md`, and the plan
content in the MHacks 2026 Google Doc ("Demo Flow", "Stack", "Competitors & Differentiation",
"Muse Reel Research Review", and the track tabs). Merged on 2026-10-03.

**Precedence:** this file wins. If the Google Doc, a prompt, or a note disagrees with it, update
this file (by PR or by telling the spec owner) instead of working from the other copy.

**Doc-sync rule:** the Google Doc is for discussion and research. Any decision made there is not
real until it lands in this file. Whoever makes a decision in the doc (or in chat) adds it here, or
asks the spec owner to, before building on it. The repo is private: every teammate needs
collaborator access to read this file (§12). Items
marked *Open* are not decided; do not treat them as requirements. §12 lists open decisions and
the one unresolved conflict between the team's source tabs.

**How to read it:** §1–§3 say what we build and the rules it must follow. §4 is the capability
reference. §5 is how code is written. **§6 is the build plan: a ladder of MVPs, each one a
working demo that builds on the previous one.** §7 ranks the hardest obstacles.

---

## Contents

1. Product
2. Non-negotiable rules
3. Agent model
4. Capability reference
5. Architecture and engineering rules
6. MVP ladder (build plan)
7. Obstacle register (hardest problems, ranked)
8. Final demo plan
9. Prize targets
10. Research and verified facts
11. FinchNode reference
12. Open decisions and conflicts
13. Team workflow
14. Source map

---

## 1. Product

### 1.1 Problem

Medical bills and insurance denials are confusing, and most people never challenge them. In a
Commonwealth Fund survey of insured working-age adults, 45% reported a bill or copay for a service
they thought should have been covered and 17% reported a denial of a doctor-recommended service;
fewer than half of those challenged it, often because they did not know they could. (Survey
experiences, not proof that 45% of bills are wrong. See §10 for what we may and may not claim.)

### 1.2 What we build

An agent that works one persistent **case** for the patient. Given a disputed bill (and later a
denial), it gathers the evidence, works through blockers, follows up, and only marks an issue
resolved when the outcome is documented. The patient controls every commitment.

```
Case starts (bill shared, or new claim detected)
  -> get the documents          (itemized bill, EOB; request what's missing)
  -> audit                      (deterministic rules + FinchNode records)
  -> choose the next action     (billing correction, insurance appeal, missing documentation,
                                 or financial-assistance referral)
  -> act                        (call or write, after patient approval)
  -> adapt to the response      (new evidence can confirm, disprove, or leave an issue pending)
  -> wait and resume            (pending tasks survive until the response arrives)
  -> verify                     (revised statement or written resolution before "resolved")
  -> denial appeal (stretch)    (criteria matched to records from every provider)
```

The case stays connected: evidence, documents, call outcomes, and approvals carry forward, so the
patient never starts over.

### 1.3 Pitch

Two candidates from the team (*Open*, §12):

- Agent framing: "Give our agent a disputed medical bill. It gathers the evidence, works through
  the blockers, and follows up until there's a documented outcome, with you controlling every
  commitment."
- Evidence framing: "Your records are scattered across providers. We assemble the evidence, show
  you exactly what supports your case, and help you act on it."

Both are true of the product; pick one for the demo close.

### 1.4 Positioning and competitors

Checked 2026-10-03 from public websites; advertised features, not tested performance. A missing
feature on a public page does not prove a competitor lacks it.

| Competitor | What they advertise | Overlap |
|---|---|---|
| Goodbill | Gets itemized bills, compares records against charges with billing experts, negotiates; 20% of savings | Records-based auditing, document collection, negotiation |
| Medvox | Bill analysis, AI navigates phone trees and hold, a human negotiator takes over; 25% of verified savings | Bill review, phone advocacy |
| Upfronte | Photo/PDF analysis against hospital pricing data, dispute letters, negotiation | Broad AI bill-advocate pitch |
| MyMedBill, AiMyClaims, Medical Bill Negotiator: IQ, CareRoute | AI bill review, dispute letters, scripts, success-fee negotiation | Bill audit and disputes |
| Counterforce Health | Free AI denial appeals from uploaded documents and policy terms; "Maxwell" voice assistant in beta | Evidence-based appeals, conversational help |
| Claimable | Appeals from history, research, and policy; mails/faxes them; ~$40 | Evidence drafting and follow-through |
| Fight Health Insurance | Free AI appeal letters with PubMed citations | Appeal drafting |
| Dollar For | Charity-care eligibility and applications | Financial assistance |
| Cedar Kora, Collectly Billie, Infinitus, Prosper AI | Voice agents for hospitals and insurers | Same calls, other side of the table |

**What we do better (lead with these; do not claim to be the only tool):**

1. **Evidence assembled across providers automatically** through FinchNode, shown per requirement.
2. **Every claim is inspectable:** bill line, EOB line or record, provider, date, triggering rule,
   uncertainty. A potential issue is never presented as a confirmed error.
3. **The agent adapts:** new evidence can confirm, disprove, or leave an issue pending, and the
   agent changes its plan instead of pushing its first guess.
4. **The patient controls the live call:** offers and conditions are shown, the patient chooses,
   a timeout means no agreement, and Take over is always available.
5. **Follow-through to a documented outcome:** amount questioned, reduction offered, and reduction
   confirmed are separate; savings count only with written proof.

### 1.5 Why FinchNode is essential

FinchNode's judges asked "what are you doing with the data? new perspective." Our answer: records
are used as evidence against a bill or an insurer, not just viewed.

- **Bill audit:** records let the agent ask whether a charged lab or medication is documented.
- **Denial appeals:** the evidence is spread across every provider the patient has seen; without
  FinchNode there is no evidence.
- **Case start (stretch):** a new claim in FinchNode's claims data can open a case.

---

## 2. Non-negotiable rules

These apply to every MVP. The audit and test phases (§13) enforce them.

1. **The AI never writes or interprets a health fact.** Every health fact in a letter, script,
   call, text, or screen is copied verbatim from a FinchNode record with its source (provider +
   date). No summarizing, paraphrasing, or inferring.
2. **Findings are deterministic.** Audit flags and appeal evidence come from fixed TypeScript rules
   and lookup tables, never from LLM judgment. Each cites its bill line, EOB line, or record.
3. **Missing is not wrong.** A charge with no matching record is a documentation gap and becomes a
   documentation request, never "you were overcharged". A potential issue is never called a
   confirmed error.
4. **The AI chooses administrative actions, not facts.** It may pick the next action from the case
   state and tool results, read documents for patient confirmation, draft prose around verified
   findings, and speak on calls. It cannot add findings or health claims.
5. **The patient decides, and their constraints bind.** Nothing is sent, submitted, disclosed, or
   agreed to without explicit patient approval. Constraints the patient sets (e.g. "don't agree to
   pay anything") hold for the whole case. A timeout means no.
6. **A human can take over at every step:** an approval gate, a Take over option, and automatic
   handoff when the agent is unsure or the other side needs the patient (§4.7).
7. **Every document is tracked** from request to response (§4.6).
8. **A representative's assertion alone is not proof.** Issues resolve only on documented
   evidence; a verbal promise creates a follow-up task.
9. **Simulations are labeled.** Any fixture, simulated arrival, time-compressed wait, or saved
   response is clearly labeled in the demo. A downloaded PDF is not proof of submission.
10. **No medical advice,** diagnosis, treatment suggestions, or drug substitution advice.
11. **No portal credentials.** The app never stores patient portal passwords or scrapes portals.
12. **No real patient data;** FinchNode synthetic sandbox and fixtures only.
13. **No secrets in git.** Keys live in `.env`; `.env.example` documents each variable.
14. **No AI authors or co-authors on commits.**
15. **Claims hygiene:** no unsourced statistics (§10), no promised savings, no claimed success rates.

---

## 3. Agent model

### 3.1 The case

One persistent case per bill (and its related denial). It holds: goal, patient constraints, cited
evidence, findings with status (potential, confirmed, withdrawn, pending), current blocker, next
action, pending tasks, approvals, documents (§4.6), call records, and outcome.

### 3.2 Loop

```
observe -> choose an action -> use a tool -> inspect the result -> update the case
        -> continue, wait, or ask the patient
```

The LLM picks among the **actions currently allowed** by deterministic guards in `lib/cases/`
(state machine + approval requirements). It never acts outside that list, and every action is
logged as a case event.

### 3.3 Tools

Each tool has explicit inputs, an authorization requirement, and an observable result. Unsupported
actions become requests or handoffs.

| Tool | Needs approval | Result |
|---|---|---|
| Retrieve records (FinchNode) | No (patient already consented) | Records with provenance |
| Retrieve matching EOB | No | EOB or "not available" |
| Request a missing document (itemized bill, EOB, records, revised statement) | Yes | Pending task + document entry |
| Call billing office | Yes (and what may be disclosed) | Call record, transcript, outcome |
| Call insurer (stretch) | Yes | Denial reason, criteria, reference number |
| Prepare correspondence (dispute, appeal, doctor request) | Draft: no; send: yes | Draft, then sent document |
| Ask the patient | No | Patient decision |
| Record a response or arrived document | No | Updated evidence; checks rerun |
| Schedule follow-up | No (proposal) / yes (contact) | Follow-up task with date |
| Check a revised statement | No | Comparison against the original |

### 3.4 Next-action routing

From the confirmed bill, EOB, denial, and plan documents, choose the right path. Do not route every
case to an appeal or a negotiation:

- **Billing correction** (provider error: duplicate, bill exceeds EOB patient responsibility)
- **Insurance appeal** (payer denied or under-covered)
- **Missing documentation** (itemized bill, EOB, records, or trial documentation needed)
- **Financial-assistance referral** (request the hospital's actual policy or use an eligibility
  screener such as Dollar For; assistance is never assumed)

### 3.5 Outcome branches (the adaptive core)

The same bill-dispute case has three versions. The teammate playing billing picks one during the
demo without telling the agent; the agent only sees the actual response and documents.

| Branch | Agent must |
|---|---|
| Evidence confirms an error | Pursue the correction, request written confirmation, verify the revised bill before marking resolved |
| Evidence disproves the concern | Withdraw the finding, cite the new evidence, explain the change to the patient, continue with any remaining issue; claim no savings from a valid charge |
| Evidence is incomplete | Request the specific missing document, record the responsible party, leave the issue pending |

### 3.6 Waiting and resuming

When the other side says "we'll send it later", save the pending task and case state (goal,
evidence, constraints, approvals, blocker, requested document), show a waiting status and the next
follow-up. When the document arrives, attach it to the same case, rerun the relevant checks, and
resume from the saved blocker. New actions or disclosures still need approval.

### 3.7 Stopping conditions

Stop and hand off for: patient input needed, unresolved evidence, unavailable tool, identity
verification, off-script requests, or repeated failure. Never loop indefinitely.

### 3.8 Success checks

- Did the plan change appropriately for the selected branch?
- Did each action cite supporting evidence, with uncertainty explicit?
- Were constraints, approval gates, and Take over respected?
- Were resolved and pending issues distinguished accurately?
- Could the case wait and resume when new evidence arrived?

### 3.9 Showing the agent's work

The case screen shows goal, evidence, blocker, next action, tool results, approvals, and status, as
an evidence-backed explanation (not a reasoning transcript). The **"What happens next?" card**
(§4.10) changes when the obstacle changes.

---

## 4. Capability reference

Each MVP in §6 lists which of these it builds. Build only what the current MVP needs.

### 4.1 Records (FinchNode)

Hosted Connect flow; server-side client in `lib/finchnode/` returning our own types; `USE_MOCK`
switch to saved sandbox snapshots. Show live sandbox records in the demo when the network allows.
See §11.

**Built (2026-10-04, `lib/finchnode/live.ts`):** `USE_MOCK=false` loads records in this order, and
the audit screen labels which one answered: (1) live sandbox: `POST /connect/sessions` →
`/simulate` with scenario `multi-source-overlap` → poll for `subject` → `GET /users/{subject}/records`
(set `FINCHNODE_SUBJECT` to skip Connect); (2) FinchNode's public demo API (same normalized format,
no key); (3) the saved snapshot `fixtures/finchnode/multi-source-overlap.json`. A failed Connect is
not retried for 10 minutes. Records map to `VerbatimFact` (labs, medications, conditions,
immunizations) with FinchNode's text, LOINC/RxNorm/CVX code, date, source name, and record ID;
records missing provenance are skipped with a warning. `npm run finchnode:check` runs the loader.
**Known issue:** sandbox simulations import records but stay at `system-selected` with no `subject`
(seen on every attempt 2026-10-04), so the demo API currently answers. Ask FinchNode at their booth.

### 4.2 Document intake and extraction

- **Entry points:** upload or one-tap share (PWA share target; iMessage thread as fallback) of an
  itemized bill, EOB, revised statement, or denial letter. **"I only have a balance statement"**
  is a supported entry: the agent prepares a patient-approved itemized bill request and explains how
  to get the EOB. Never invent billing codes or reconstruct charges from a total.
- **Principle:** the model proposes, code verifies, the patient confirms. Nothing reaches the audit
  until all three have happened.
- **1. Classify first.** Before extracting, classify the document: itemized bill, balance
  statement (total only), EOB, revised statement, denial letter, or unknown. Each type has its own
  schema. A balance statement routes to the itemized-bill request path. A document covering several
  billing entities (e.g. facility and clinician) is split into one bill per entity.
- **2. Strict schema with provenance.**
  - Header: billing entity, provider type (facility, clinician, other), account number, patient
    name, service date range, encounter, statement date, total charges, adjustments, payments,
    amount due.
  - Per line: line number, service date, code, code type (CPT, HCPCS, revenue code, NDC, unknown),
    description, quantity, unit price, charge, adjustment, patient responsibility.
  - Every field stores: raw text exactly as printed, normalized value (integer cents, ISO date),
    page number, source snippet, and status (`read`, `unreadable` shown as "[to confirm]", or
    `absent`). Missing values are `null`, never guessed.
- **3. Extraction method.** Gemini (only via `lib/llm/`) with a required output schema
  (structured output), temperature 0, one call per page for long bills, then merged. **Document
  text is data, never instructions:** text inside a document (e.g. "ignore previous instructions")
  cannot change behavior.
- **4. Text-layer cross-check.** If a PDF has a real text layer, every extracted amount, code, and
  date must appear in the PDF's own text near its cited snippet. Photos and scans have no text
  layer and get stricter confirmation instead.
- **5. Deterministic validation checks** (each failure flags the specific field):
  - line charges sum to total charges; total minus adjustments and payments equals amount due;
  - quantity × unit price = charge when both are shown;
  - code formats (CPT 5 characters, HCPCS a letter plus 4 digits, revenue codes 4 digits); format
    only, since the CPT code set is licensed by the AMA, so never validate against it;
  - every service date falls within the stated service range;
  - no repeated line numbers; amounts parse as currency with sensible signs (adjustments negative);
  - with an EOB present, each line maps to an EOB line and patient responsibility is compared per
    line.
- **6. Confidence comes from checks, not the model.** A field is `verified` only if it passes its
  checks (and, for PDFs, matches the text layer); otherwise it is `needs attention`. The model's
  self-rated confidence is ignored.
- **7. Confirm screen.** Show the page image with each field's snippet highlighted. Fields that
  need attention come first and are confirmed or corrected one by one; verified fields can be
  confirmed in one tap. Corrections are recorded as case events. Fields are `Unconfirmed<T>` until
  confirmed; only the confirmed version is used downstream, and it is locked once confirmed.
- **8. Failure handling.** Blurry or unreadable: ask for a retake or the PDF. Not itemized:
  balance-statement path. Totals don't reconcile: the audit is blocked until the flagged fields are
  resolved. Never audit unconfirmed data.
- **9. Traceability.** Store the original file, the raw model output, and the model, prompt, and
  schema versions for every extraction, so any number can be traced back and re-extracted.
- **Bill vs EOB:** explain that an EOB is not a bill; show charge, adjustment, and patient
  responsibility separately before any dispute.
- **Provider separation:** keep facility, clinician, and other provider bills separate; match by
  encounter and service. Similar descriptions alone do not make a duplicate.

### 4.3 Audit rules (deterministic, `lib/audit/`)

| Rule | Flags when | Notes |
|---|---|---|
| Duplicate charge | Same code, date, amount, provider, encounter | Quantity differences are not duplicates; becomes "potential duplicate" until confirmed |
| Bill exceeds EOB | Billed patient responsibility > EOB patient responsibility | Needs the matching EOB |
| Documentation gap | Lab or medication charge with no matching record | Lookup table from demo billing codes to record types; documentation request, not overcharge |
| Out-of-network surprise | Out-of-network charge on emergency care | Flag "No Surprises Act may apply"; jurisdiction details *Open* |
| Coding mismatch | *Open:* only if a simple, defensible check exists | Skip rather than guess |

Large sticker prices alone are not errors; "above typical" pricing needs a real price dataset and is
out of scope.

### 4.4 Evidence inspection

Every finding and every letter sentence links to its evidence: bill line, EOB line or record,
provider, date, triggering rule, uncertainty, and status. Clicking a sentence opens its source.

Layout ideas adapted from the `medical-bill-decoder` Claude skill (paraphrase only; check its
license before reusing any text): a **verdict block** at the top (total billed, amount questioned,
reduction offered, reduction confirmed) and a **line-by-line table** (line, code, plain-language
description, amount, finding status). Unlike that skill, the AI never assigns severity or red
flags; every flag comes from a §4.3 rule.

### 4.5 Drafting (`lib/draft/`)

The LLM writes structure and prose with placeholders like `{{evidence:rec_123}}` or
`{{bill_line:4}}`; code replaces each with the verbatim value and source. Reject drafts with
unknown or unfilled placeholders. Outputs: dispute letter or email, documentation request,
itemized bill request, doctor request, appeal letter (PDF via `@react-pdf/renderer`), call
scripts. Closing disclaimer on letters and screens: plain-language help, not legal or financial
advice; rules vary by state and plan.

### 4.6 Case, paperwork tracker, verification

- **Documents tracked:** claim/EOB, itemized bill, balance statement, requests sent, written
  dispute, billing office confirmations, revised statement, denial letter, appeal, doctor
  requests, insurer acknowledgements and decisions, call transcripts and summaries.
- **Per document:** type, direction, status, dates, method (call, email, mail, fax, portal),
  counterparty, reference number, file, cited findings or records, deadline, follow-up date.
- **Statuses:** requested, received, drafted, approved, sent, acknowledged, awaiting response,
  resolved. Appeals add: draft ready, patient approved, submitted, receipt confirmed, decision
  received.
- **Verification:** a verbal adjustment creates a follow-up task; request the revised bill or
  written resolution; compare it with the original; mark resolved only when documented.
- **Savings accounting:** amount questioned, reduction offered, and reduction confirmed shown
  separately; an unresolved case stays pending.
- **Reminders:** Photon texts before deadlines and when a response is overdue; the agent proposes
  the follow-up and waits for approval.
- **Timeline and export:** one chronological view of documents, calls, decisions, and handoffs;
  exportable case packet for a human advocate.
- Data: `cases`, `documents`, `findings`, `case_events`, `approvals`, `deadlines`, `calls` tables
  in Neon; original files in a private Neon `files` table for now (uploads are capped at 15 MB;
  *Open:* move to Vercel Blob or similar if size becomes a problem). Migrations live in
  `db/migrations/` (`npm run db:generate`, `db:migrate`, `db:check`). Relationships:

  ```
  cases 1─* documents     (each file or request; status, method, counterparty, reference no.)
  cases 1─* findings      (rule, status: potential|confirmed|withdrawn|pending; source refs ->
                           bill/EOB line in a document, or a FinchNode record ID)
  cases 1─* calls         (counterparty, Twilio conference ID, transcript ref, outcome)
  cases 1─* approvals     (what was approved, by whom, when; required before any action)
  cases 1─* deadlines     (linked to a document; due date, follow-up date, reminder state)
  cases 1─* case_events   (append-only timeline: tool calls, results, handoffs, decisions;
                           may reference a document, finding, call, or approval)
  ```

- **Uploaded files:** private storage only; access through short-lived signed URLs; never public
  links; document contents leave our system only through `lib/llm/` (Gemini); never log document
  contents; synthetic data only (rule 12).

### 4.7 Human handoff (every stage)

- **Approval gate** before any call, send, submission, disclosure, or commitment.
- **Take over:** drafts are editable; tasks can be marked "I'll do this myself"; on a live call a
  Take over button patches the patient in (Twilio conference) and the agent drops off or stays as a
  silent note-taker. *Open:* warm transfer vs hand-back with call notes (§12).
- **Automatic escalation:** identity verification or patient authorization required; off-script
  request; unsupported denial or no evidence; low-confidence extraction or contradiction with
  records; deadline too close; mid-call decision timeout.
- Every handoff is logged as a case event.

| Stage | Approval gate | Typical escalation |
|---|---|---|
| Case start | Confirm the case and document requests | Claim data unclear |
| Document request | Approve the call or letter | Office requires patient verification |
| Audit | Confirm extracted fields; review findings | Low-confidence extraction |
| Dispute and negotiation | Approve contact and disclosures; choose options mid-call | Off-script question, offer outside options, timeout |
| Denial investigation | Approve the insurer call | Insurer requires the member |
| Written appeal | Review, edit, approve | Unsupported denial, missing evidence |
| External review | Approve filing | Always patient-led |

### 4.8 iMessage agent (Photon Spectrum)

Two-way conversation that remembers the case: status updates, new blockers and next steps, "reply A
or B" approvals, mid-call choices when the patient isn't on the call screen, deadline reminders,
and plain-language answers to "why was this flagged?" grounded in findings and citations. Replies
map to the right case and action; unknown, late, or duplicate replies are handled. Must use
Spectrum on iMessage to qualify for the Photon prize.

### 4.9 Voice calls (ElevenLabs + Twilio)

| Step | Channel | Voice agent role |
|---|---|---|
| Request itemized bill / EOB / documentation | Phone, portal message, or letter | Short routine request |
| Dispute errors | Phone first, then **written** dispute | Flag issues with cited questions; ask for documentation |
| Negotiate (discounts, payment plans, charity care) | Phone | Main channel; patient steers live |
| Investigate a denial (stretch) | Phone to insurer | Exact denial reason, criteria, reference number, status |
| Appeal a denial | **Written** | None (some urgent appeals can start by phone; rules vary) |
| External review | Written | None |

- Scripts come from findings; the agent may only say approved things and must not paraphrase
  health facts (it reads values supplied by tools; see obstacle O4 in §7).
- **Live call screen:** status, running transcript, decision prompts, Take over button.
- **Script starting points:** the `medical-bill-decoder` skill's three scripts (request an
  itemized bill, ask about financial assistance, negotiate) can be adapted for the ElevenLabs
  agent's per-call instructions; paraphrase, keep §2 rules, check the license.
- **Mid-call decisions:** on a decision point the agent calls `ask_patient(question, options)`,
  says "one moment while I check with the patient"; the patient picks one of 2–4 options or types a
  short instruction; Photon fallback if the screen is closed.
- **Timeout:** agree to nothing; ask for written terms or a callback.
- The agent can never commit to payment, settlement, or disclosure the patient didn't choose.
- Real billing offices verify identity and may need the patient's authorization; for the demo a
  teammate plays the office. *Open:* consent model (§12).

### 4.10 Denial appeals (stretch)

- **Classify** the confirmed denial reason; unsupported types are said plainly.
- **Match criteria to evidence** (patient-confirmed criteria from the denial letter and insurer
  call). Each criterion is **met** (with supporting records), **missing** (with exactly what is
  needed), or **unconfirmed**.

  | Denial reason | Met only when the records show | FinchNode data |
  |---|---|---|
  | Step therapy | For each required drug: prescribed **and** the trial documented (dates or duration, and outcome or reason stopped) | Medications, plus notes/conditions where available |
  | Not medically necessary | Each policy criterion supported by a documented condition, lab, or prior treatment (lookup table) | Conditions, labs, medications |

  **A prescription or a stopped medication alone does not prove the trial was completed.**
- **Next action:** all met → cited appeal (criterion by criterion: "Insurer requires X; records show
  Y"); any missing → patient-approved documentation request to the treating provider (no weak
  appeal); unsupported → plain message and handoff.
- **"What happens next?" card:** next action, why (records and gap), what is needed, responsible
  party, deadline (from the confirmed denial notice; "unconfirmed" if unavailable), review button.
  Example: *Request documentation from your doctor. Why: the records show medication A was
  prescribed but do not document the trial outcome. Needed: treatment dates and outcome.*
- Submission is tracked by status (§4.6); demo any submission or receipt with a labeled fixture
  unless the integration actually performs it.

### 4.11 Proactive case start (stretch)

When FinchNode claims or coverage data shows a new claim (scheduled sync or signed webhook), the
agent opens a case and offers to request the itemized bill. *Open:* claims availability beyond
Medicare and in the sandbox; otherwise simulate from a labeled fixture.

### 4.12 Later

Caregiver mode (authorized family member with explicit permissions and a record of who acted),
external review filing, Fetch.ai agent, Capital One Nessie payment view, native wrapper
(Capacitor).

---

## 5. Architecture and engineering rules

### 5.1 Stack

| Layer | Choice | Why | Prize |
|---|---|---|---|
| App | Next.js (TypeScript, App Router), mobile-first web, installable PWA | Judges open a URL; one codebase; Photon gives the app feel; no app store | — |
| UI | Tailwind + shadcn/ui | Fast, polished screens | Figma (if designed there first) |
| Hosting | Vercel | Deploy on push, public URL | — |
| Database | Neon Postgres + Drizzle ORM | Typed schema, serverless | Neon |
| Login | Neon Auth if time allows, else one demo user | Strengthens Neon entry | Neon |
| Records | FinchNode API, server-side, `USE_MOCK` switch | Evidence | FinchNode |
| AI | Two providers behind one interface, only in `lib/llm/`: **Grok** (xAI, `grok-4.20-0309-non-reasoning`, constant `GROK_MODEL`) for everyday use, paid from the team's xAI credits; **Gemini** (`gemini-3.5-flash`, constant `GEMINI_MODEL`) kept for the judged demo and as a fallback. `LLM_PROVIDER` picks one; default is Grok when `XAI_API_KEY` is set. Grok reads images, not PDFs, so PDF pages are rendered to PNG (`lib/llm/pdfPages.ts`); the PDF text layer is never sent, keeping the cross-check independent. Both pass the live extraction eval 334/334 (2026-10-03/04). Gemini's free tier allows only 20 requests/day per project per model; the `gemini-flash-latest` alias kept returning 503/429. Rerun the eval after any model change | Document reading (PDF/photo), drafting, action choice among allowed actions | MLH Gemini (demo must run on Gemini: `LLM_PROVIDER=gemini`) |
| Rules | Pure TypeScript in `lib/audit/`, `lib/evidence/`, Vitest | Deterministic, cited findings | — |
| PDF | `@react-pdf/renderer` | Letters | — |
| Voice | ElevenLabs Conversational AI + Twilio; `ask_patient` server tool | Calls with patient control | ElevenLabs, MLH ElevenLabs |
| Texts + live screen | Photon Spectrum on iMessage in a long-running Node worker; SSE/websockets to the browser | Two-way iMessage, live call updates | Photon |
| Planning | Notability Pro | Wireframes, screenshots | Notability |
| Domain | Free .tech domain → Vercel | Extra entry | MLH .Tech |
| Stretch agent | Fetch.ai uAgent (Python) on Agentverse | "Appeal my denial" from ASI:One | Fetch.ai |
| Native (optional) | Capacitor wrapper of the same web app, only at the end | No rewrite | — |

**Why Twilio:** ElevenLabs provides the voice agent but cannot dial a phone number by itself.
Twilio is its built-in phone carrier, and Twilio's conference API is what makes holding the rep and
Take over possible (§7.1). Twilio is not a sponsor and earns no prize.

Not used: Gemini Live for voice (would lose both ElevenLabs prizes and require a custom real-time
audio bridge between Twilio and Gemini), Grok/SpaceXAI, Relay for messaging (Photon instead), Spacetime, FREE-WiLi, Solana, Tiger Data, Presage.

### 5.2 How the pieces connect

Phone browser → Next.js on Vercel (API routes call `lib/`) → FinchNode (or mock), Gemini, Neon.
The Photon worker (Railway/Render or a laptop; Vercel can't host it) handles iMessage and pushes
live call updates. ElevenLabs places calls through Twilio and calls back to our `ask_patient` tool.

### 5.3 Repo layout

```
app/                 pages + API routes (thin: validate input, call lib/, return)
lib/finchnode/       FinchNode client + USE_MOCK switch (only code that talks to FinchNode)
lib/extract/         document reading + confirmation flow
lib/audit/           bill-audit rules + lookup tables (pure)
lib/evidence/        denial-appeal criteria matching + lookup tables (pure)
lib/draft/           drafting, verbatim insertion, PDF
lib/cases/           case state machine, allowed actions, approvals, handoffs, paperwork, deadlines
lib/llm/             the only code that talks to Gemini
lib/types/           shared types (the contract between workstreams)
db/                  Drizzle schema + queries
fixtures/            sandbox snapshots, bills, EOBs, branch documents, revised statements, denial
workers/photon/      Photon Spectrum worker
voice/               ElevenLabs agent config + Twilio glue
agents/fetch/        Python uAgent (stretch)
tests/               Vitest tests mirroring lib/
```

- Pure logic lives in `lib/`; routes, workers, and UI call it.
- Shared types change by agreement: mention it in the commit and the task's notes.

### 5.4 TypeScript conventions

- `strict: true`; no `any` (use `unknown` and narrow); no `@ts-ignore` without a reason.
- Validate every external input with **zod** at the boundary: requests, FinchNode responses, LLM
  output, webhooks, A/B replies.
- Small pure functions; side effects at the edges.
- Domain names (`findDuplicateCharges`, `StepTherapyCriterion`), not `process` or `data`.
- Typed errors or result unions; never swallow an error; never let a failure produce output that
  looks complete.
- Money is integer cents; dates are ISO 8601 strings at boundaries.
- Prettier + ESLint before committing.

### 5.5 Docstrings (required on everything)

TSDoc (`/** */`) in TypeScript, Google style in Python, on **every** file, function (exported or
not), type and field, constant and lookup table, React component, and test. A docstring lets a
teammate or a fresh agent use and change the code without reading the body.

- **File:** `@file` purpose and the SPEC.md section it implements.
- **Function:** what and why in domain terms; `@param` (meaning, units, range); `@returns`
  (including what empty means); `@throws`; invariants (e.g. "deterministic", "never adds items");
  side effects or "Pure: no side effects"; `@example` when non-trivial; spec link.
- **Types:** what each field means. **Constants/tables:** their source and scope (e.g. "demo codes
  only, not a clinical reference"). **Components:** what they show, props, user actions.
  **Tests:** the requirement or risk they prove.

```ts
/**
 * Finds potential duplicate charges on a patient-confirmed itemized bill.
 *
 * Two lines are potential duplicates when code, service date, amount, provider, and encounter
 * match. Quantity differences are not duplicates. Each finding cites every line in its group.
 * Pure: no side effects. Deterministic: output follows bill line order.
 * Implements SPEC.md §4.3 "Duplicate charge".
 *
 * @param bill - Patient-confirmed bill (validated by `BillSchema`); amounts in integer cents.
 * @returns One finding per duplicate group; empty array when none.
 */
export function findDuplicateCharges(bill: ConfirmedBill): DuplicateFinding[] { ... }

/** A health fact copied exactly from one FinchNode record. Never constructed from LLM output. */
export interface VerbatimFact {
  /** The record's own text, unmodified. */
  text: string;
  /** Source provider, e.g. "Northstar Health System". */
  provider: string;
  /** When the provider recorded it, ISO 8601. */
  recordedAt: string;
  /** FinchNode record ID, for tracing back to the source. */
  recordId: string;
}

/**
 * Proves the step therapy rule does not treat "prescribed, then discontinued" as a completed
 * trial: without documented dates or duration and an outcome, the criterion is "missing"
 * (SPEC.md §4.10).
 */
it("marks an undocumented trial as missing", () => { ... });
```

Update the docstring in the same change as the code; a wrong docstring is a bug.

### 5.6 How §2 is enforced in code

- `VerbatimFact` is created only in `lib/finchnode/`.
- Drafts use placeholders filled by code (§4.5).
- LLM output is zod-validated; retry once, then fail visibly.
- Finding types require a `source` field; a finding without one does not compile.
- Extracted fields are `Unconfirmed<T>` until confirmed; rules accept only confirmed types.
- `lib/cases/` exposes only allowed actions; no code path calls, sends, submits, or discloses
  without a recorded approval; escalation conditions are explicit tested functions.
- Any document event writes a `documents` row and a `case_events` entry in one transaction.
- Voice and text agents only say approved things; commitments need a recorded patient choice.

### 5.7 Testing

Vitest. Every rule has positive, negative, and edge tests against `fixtures/`, not the live API (a
separate smoke script checks the sandbox). Mock `lib/llm/`, including malformed output, unknown
placeholders, and extra health claims, and assert they are rejected. Test the three outcome
branches, waiting and resuming, approvals, and handoffs. `npm test` passes before pushing.

**Extraction test set** (checked field by field against known answers):
- the same bill as a clean PDF, a scanned PDF, and a tilted phone photo;
- a multi-page bill;
- a balance statement and an EOB;
- a bill with deliberately broken totals (must block the audit);
- a bill containing a prompt-injection line (must not change behavior).

**Eval budget for the hackathon:** about 10–15 cases beyond unit tests: the extraction fixtures
above, the three outcome branches plus waiting and resuming, 2–3 bad-AI-output cases (malformed
output, an invented fact, an unknown placeholder), and 2–3 rehearsal calls with a transcript check
for unsourced facts or unapproved commitments. No benchmark datasets, accuracy percentages, or
fine-tuning. The `medical-bill-decoder` skill's issue list (duplicates, unbundling, balance billing,
care never rendered, bill/EOB mismatch) is a source of extra scenarios.

### 5.8 Git

Pull first; small focused commits; push often. Branch and PR for changes to shared code
(`lib/types/`, `db/`). Imperative commit messages. Never force-push `main`, commit `.env`, real
data, or build output.

### 5.9 Accounts and keys

FinchNode (free plan + sandbox), Neon, Google AI Studio (Gemini), ElevenLabs (agent), Twilio
(number), Photon (Spectrum + iMessage), Vercel, worker host (Railway/Render or laptop); optional
Agentverse, .tech domain.

**Free plans and trials:** the team uses free tiers and trials across services. Stay within each
provider's terms: creating multiple trial accounts with one provider to get around its limits
usually violates them (Twilio, for example, can suspend accounts). **Pin one stable account per
service for the demo:** a Twilio trial number, its verified-number list, and the ElevenLabs agent
are tied together, so switching keys or numbers near the demo is a likely way to break the call.
Keep keys in `.env` only.

**Twilio trial:** about $15 credit for 30 days; calls only to verified numbers (verify the phone
of the teammate playing billing, plus a backup); one number per trial account; trial calls start
with a Twilio announcement and may require a keypress before connecting. Test this in the first
call spike; if it gets in the way, upgrade (about $20) before judging.

### 5.10 Definition of done

Does what the plan says and nothing unrelated; accurate docstrings on everything new or changed;
external input validated; tests pass and new rules have tests; lint and types pass; task notes
updated.

---

### 5.11 Product agents vs Claude skills

Two different things share the word "agent" in this project; keep them separate.

- **Product agents** are what judges see: the case agent (Gemini choosing among allowed actions
  in `lib/cases/`), the extraction and drafting steps (Gemini via `lib/llm/`), the voice agent
  (ElevenLabs over Twilio), and the iMessage agent (Photon). They are **configured by prompts,
  schemas, tools, and code**, and they are **never trained or fine-tuned** in this project. A
  Claude skill file cannot be loaded by them, because they do not run on Claude.
- **What improves product agents:** better prompts and output schemas, the deterministic guards
  and checks in this spec, few-shot examples written into their prompts, and the tests in §5.7
  (fixtures plus scenario checks). Ideas from outside material (such as the `medical-bill-decoder`
  skill) enter the product only by being rewritten into those prompts, rules, and tests.
- **Claude skills** are instructions for Claude Code while the team develops: for example the
  plan/implement/audit/test prompts in `prompts/`, or built-in skills like `/run`, `/code-review`,
  and `/security-review`. They help build the product but are not part of it, and they need no
  evals for the hackathon.
- **Consequence:** do not plan work as "train an agent" or "install a skill into the product."
  Plan it as prompt, schema, rule, tool, or test changes in the relevant `lib/` folder.

## 6. MVP ladder (build plan)

Each MVP is a **working demo on its own** and **builds on the previous one**. If time runs out, we
demo the highest completed MVP. Hours are from hacking start (H0 = Sat 12:00 PM); check the exact
Devpost deadline and keep the last 2–3 hours for freeze, video, and submission.
Status is current as of 2026-10-03 night; update the Status column whenever a rung changes (details in `HANDOFF.md`).

| MVP | Name | Target | Status | Demo on its own | Main prizes it unlocks |
|---|---|---|---|---|---|
| 0 | Walking skeleton | H0–H2 | **Mostly done** (left: deploy, real FinchNode fixtures, CI) | Deployed URL with a seeded case and fixture evidence | — |
| 1 | Cited bill audit | H2–H6 | **Built**; live eval passes on Gemini and Grok; Neon live (data persists, `?case=` reload); audit/test phases pending | Bill + EOB in → confirmed fields → cited findings → dispute letter | MLH Gemini, Neon (partial) |
| 2 | Adaptive case with live records | H6–H11 | **Started**: live FinchNode client built (demo API answering; sandbox Connect stuck); fixtures rebuilt around the FinchNode patient; case engine, branches, verification, and API built; case screen and operator console next | Full adaptive dispute, three branches, wait/resume, verified outcome (operator console plays billing) | **FinchNode**, AI or FinTech track |
| 3 | Patient in the loop on iMessage | H11–H14 | Not started | MVP 2 driven from iMessage, with "why?" answers and approvals | Photon |
| 4 | Live patient-controlled call (**core demo**) | H14–H19 | Not started | MVP 3 plus a live phone call with an unannounced obstacle, mid-call choices, Take over | ElevenLabs, MLH ElevenLabs |
| 5 | Cross-provider denial appeal (stretch) | H19–H21 | Not started | Denial → criteria vs records from both providers → appeal or doctor request | Strengthens FinchNode |
| 6 | Polish and extra entries (parallel, as time allows) | any | Not started | PWA, Neon Auth, .tech, Notability, proactive claim start, Fetch.ai | Neon, .tech, Notability, Fetch.ai |
| — | Freeze | last 2–3 h | — | Recordings, Devpost, submission steps (§9) | — |

### MVP 0 — Walking skeleton (H0–H2)

**Goal:** everyone can build in parallel against the same contract.

- **Build:** Next.js app deployed to Vercel; Neon + Drizzle schema (`cases`, `documents`,
  `findings`, `case_events`, `approvals`, `deadlines`); `lib/types/` contract; `lib/llm/` Gemini
  smoke call; `lib/finchnode/` mock returning a saved sandbox snapshot; fixtures v1 (one synthetic
  patient with records at both providers, itemized bill with a potential duplicate and an unmatched
  lab charge, matching EOB); lint, Prettier, Vitest, docstring rule in CI or pre-commit; `.env.example`.
- **Demo:** open the URL, see a seeded case with the bill lines, EOB, and records with provenance.
- **Exit criteria:** deploy works from `main`; all four devs import the shared types; Gemini and
  Neon keys verified.
- **Early spikes (do now, they gate later MVPs):** O5 FinchNode data fit (§7.2), O3 Photon
  iMessage credentials, O1/O2 call orchestrator spike (§7.1).
- **Owners:** Dev 1 fixtures + FinchNode mock; Dev 2 app shell + deploy, and **Notability owner**
  (sketch screens and flows in Notability Pro during planning, save 2+ screenshots for Devpost;
  required for the Notability prize); Dev 3 types + Gemini smoke; Dev 4 schema +
  Photon/ElevenLabs/Twilio account setup.

### MVP 1 — Cited bill audit (H2–H6)

**Builds on:** MVP 0. **Goal:** a trustworthy, inspectable audit with a written dispute.

- **Build:** §4.2 intake and Gemini extraction with the confirm screen (including "[to confirm]"
  and the balance-statement-only path); §4.3 duplicate, bill-exceeds-EOB, and documentation-gap
  rules (gap checked against mock records); §4.4 evidence inspection; §4.5 dispute letter and
  itemized-bill request with placeholder filling and PDF; potential-vs-confirmed wording; savings
  fields (questioned only).
- **Demo (60 s):** upload bill and EOB → confirm fields → two cited findings (potential duplicate,
  documentation gap) → click a sentence to see its source → download the dispute letter.
- **Exit criteria:** rules deterministic and tested; every letter sentence traces to a source;
  malformed LLM output rejected.
- **If behind:** hand-enter the confirmed fields from the fixture and skip extraction.
- **Owners:** Dev 3 extraction + drafting; Dev 1 rules + lookup tables; Dev 2 confirm, findings,
  inspection screens; Dev 4 persistence.

### MVP 2 — Adaptive case with live records (H6–H11)

**Builds on:** MVP 1. **Goal:** the agent story without voice: a case that adapts, waits, resumes,
and verifies. This is the **safety-net demo** for the FinchNode prize.

- **Build:** live FinchNode Connect + sandbox records (mock fallback); §3 case model and loop with
  allowed actions; §3.4 next-action routing; §3.5 three outcome branches with branch-specific
  fixture documents; §3.6 waiting and resuming; §4.6 paperwork tracker, timeline, verification
  against a revised statement, and savings accounting (questioned / offered / confirmed); §4.7
  approval gates, Take over on drafts, escalation rules, handoff log; bill-version "What happens
  next?" card; an **operator console** where the teammate playing billing picks the branch and
  sends responses or documents (labeled simulated).
- **Demo (2 min):** patient states the goal and "don't agree to pay anything" → records arrive from
  both providers → findings → patient approves the contact → operator picks a hidden branch → agent
  confirms, withdraws, or leaves pending accordingly → "we'll send it later" → waiting → document
  arrives → checks rerun → revised statement verified → savings confirmed only with proof.
- **Exit criteria:** all three branches produce the correct plan change; waiting/resuming works;
  nothing happens without approval; resolved vs pending is accurate.
- **If behind:** two branches (confirm, incomplete); verification against one revised statement.
- **Owners:** Dev 1 FinchNode live + branch fixtures; Dev 3 agent loop + routing; Dev 4 cases,
  paperwork, approvals; Dev 2 case screen, timeline, card, operator console.

### MVP 3 — Patient in the loop on iMessage (H11–H14)

**Builds on:** MVP 2. **Goal:** the patient runs the case from iMessage.

- **Build:** §4.8 Photon Spectrum worker on iMessage: updates on new blockers, A/B approvals mapped
  to case actions, "why was this flagged?" answers grounded in citations, deadline/overdue
  reminders, robust reply handling.
- **Demo:** the MVP 2 story with approvals and the "why?" question happening in iMessage.
- **Exit criteria:** replies route to the right case and action; duplicate/late/unknown replies
  handled; answers contain no health facts beyond verbatim citations.
- **If behind:** web approvals stay primary; iMessage sends updates only (still qualifies only if
  it's a real two-way exchange, so keep at least the "why?" answer).
- **Owners:** Dev 4 worker; Dev 3 grounded answers; Dev 2 notification states.

### MVP 4 — Live patient-controlled call (H14–H19) — **core demo**

**Builds on:** MVP 3. **Goal:** the highlight: a real call that hits an unannounced obstacle while
the patient stays in control.

- **Build:** §4.9 ElevenLabs agent + Twilio outbound call to the teammate's phone; script from
  findings; tool access to case evidence (no paraphrased health facts); live call screen with
  transcript; `ask_patient` with on-screen options and Photon fallback; timeout = no agreement;
  Take over (warm transfer, or hand-back fallback); call outcome and offer recorded as case events
  that trigger follow-up and verification. The operator branch is now chosen live by the
  teammate's spoken response.
- **Demo:** the full core demo (§8).
- **Exit criteria:** the agent adapts to the spoken branch; the payment-conditioned offer is
  displayed and never accepted without approval; Take over works; the call produces a follow-up
  task, not a "resolved" status.
- **If behind:** keep the MVP 3 demo and play a recorded call; or run the call with text-to-speech
  on the operator console.
- **Owners:** Dev 4 telephony + tool endpoint; Dev 3 agent prompt + script; Dev 2 live call screen;
  Dev 1 call-to-case event mapping.

### MVP 5 — Cross-provider denial appeal (H19–H21, stretch)

**Builds on:** MVP 4 (same case). **Goal:** the strongest FinchNode moment: records from both
providers matched to the insurer's own criteria.

- **Build:** §4.10 denial intake and classification; step therapy criteria matching (and medical
  necessity if time); missing-evidence routing with a doctor documentation request; "What happens
  next?" card for denials; criterion-by-criterion appeal draft; submission statuses with a labeled
  fixture; recorded insurer-call clip.
- **Demo (45 s, appended):** the insurer denies a related prescription → criteria confirmed →
  "Insurer requires X → records support Y → Z is missing" with cited records from Northstar and
  Quillhaven → appeal or doctor request → tracked with its deadline.
- **Exit criteria:** an undocumented trial is "missing", never "met"; no weak appeal is drafted.
- **Owners:** Dev 1 criteria rules; Dev 3 appeal drafting; Dev 2 checklist and card; Dev 4 tracker.

### MVP 6 — Polish and extra entries (parallel, as time allows)

Pick in this order, only when the current MVP is solid: PWA manifest and share target; .tech
domain; Notability screenshots (from planning done earlier); Neon Auth; proactive claim start
(§4.11, labeled if simulated); Figma file link; Fetch.ai uAgent + ASI:One submission; caregiver
mode; advocate export polish; Nessie; Capacitor.

---

## 7. Obstacle register (hardest problems, ranked)

| # | Obstacle | Severity | Hits | Why it's hard | Mitigation | Test by |
|---|---|---|---|---|---|---|
| O1 | **Patient-decision wait during a call** | Critical | MVP 4 | `ask_patient` must pause 20–60 s while the rep waits; ElevenLabs tool calls may time out sooner | Call orchestrator (§7.1): the tool returns "waiting" immediately and the orchestrator holds the rep's leg until the patient answers or the timeout (= no agreement); fallback: short "still checking" turns or a callback request | H3 |
| O2 | **Take over / warm transfer** | Critical | MVP 4 | Patching the patient into an AI call | Call orchestrator (§7.1): every call is a Twilio conference from the start, so Take over is adding the patient's leg and muting/removing the AI leg; verify ElevenLabs can join as a SIP participant (else a Twilio leg streaming to ElevenLabs); fallbacks, in order: hand-back with call notes; a browser-based call (agent and teammate in a web voice session, Take over = patient joins); Relay as an alternative to the browser call (may also earn the Relay prize; verify agent-initiated and multi-party calls first) | H6 spike, decide by H12 |
| O3 | **Photon iMessage setup with no Photon engineer on site** | High | MVP 3 | Self-serve only: Spectrum credentials, iMessage access, always-on worker, reply routing | Start now from docs (`spectrum-ts`); ask Photon's marketing officer for the fastest path to iMessage credentials and an engineer contact; build against Spectrum's terminal mode meanwhile; correlation IDs per prompt; if no iMessage access by H8, treat the Photon prize as at risk and keep web approvals primary | H4 credentials, H8 go/no-go |
| O4 | **Voice agent paraphrasing health facts** | High | MVP 4 | The voice LLM can reword or invent, which breaks rule 1 | Agent fetches values via tools and reads them as given; script restricts topics to bill lines and documents; post-call transcript check flags any unsourced fact | H16 |
| O5 | **FinchNode data fit** | High | MVP 1, 2, 5, 6 | Our plan assumes data FinchNode may not return (two-provider patient, coded labs with dates, medication dates, trial outcomes, encounters, claims, provenance) | Data-fit spike and fallbacks in §7.2; build fixtures around the real sandbox patient, not the reverse | H3 |
| O6 | **Agent loop reliability** | High | MVP 2 | Gemini must choose sensible actions, not loop, and respect constraints across branches | Deterministic state machine exposes only allowed actions; LLM picks among them; step limit; tests per branch | H10 |
| O7 | **Realtime live call screen** | High | MVP 4 | Vercel functions can't hold sockets; transcript events must stream | Push from the worker via SSE, or poll Neon every second as a fallback | H15 |
| O8 | **Extraction accuracy** | Medium-High | MVP 1 | Scanned bills and photos misread codes and amounts | Clean fixture PDFs for the demo; confirm screen; "[to confirm]"; low-confidence flags | H4 |
| O9 | **Code-to-record matching** | Medium | MVP 1, 2 | Billing codes (CPT/HCPCS) vs clinical codes (LOINC/RxNorm) | Small lookup table for demo codes only, documented as not a clinical reference | H5 |
| O10 | **Fixture consistency** | Medium | MVP 0–5 | Bill, EOB, three branch documents, revised statement, and denial must all match one sandbox patient | One owner (Dev 1); fixture checklist; labeled as synthetic | H6 |
| O11 | **Demo honesty and consent questions** | Medium | MVP 2–5 | Judges may ask about call consent, identity verification, simulated arrivals, real savings | Label simulations; prepared answers; no savings or success claims | Before judging |
| O12 | **Team coordination** | Medium | all | Shared types and schema churn with four people on `main` | Contract in MVP 0; PRs for shared code; migrations owned by Dev 4 | Ongoing |
| O13 | **Scope creep across 26 prizes** | Medium | all | Extra integrations steal time from the core demo | §9 targets only; MVP 6 after the core works | Ongoing |

### 7.1 Call orchestrator (design for O1, O2, O7)

A small service we own (in the Photon worker process or its own process; not on Vercel) owns every
call instead of ElevenLabs owning it.

```
            Twilio Conference "case-<id>"   (created and controlled by the orchestrator)
             ├── Leg A: billing office or insurer (outbound PSTN call)
             ├── Leg B: ElevenLabs voice agent (SIP participant, or a Twilio leg streaming to ElevenLabs)
             └── Leg C: patient (added only on Take over)
```

- **Start:** after approval, create the conference, dial the counterparty, add the agent leg.
- **Patient decision (O1):** `ask_patient` records the question and returns "waiting" at once; the
  orchestrator places Leg A on hold with a short "one moment please" message, pushes the options to
  the live screen and Photon, and on answer (or timeout = no agreement) takes Leg A off hold and
  passes the result into the conversation.
- **Take over (O2):** dial the patient, add Leg C, then mute or remove Leg B (or keep it muted as a
  note-taker); the counterparty hears no transfer.
- **Events (O7):** Twilio status callbacks and agent transcript events become case events and are
  pushed to the live call screen (SSE), so one component owns call state.
- **Verify early (H6 spike):** (1) an ElevenLabs agent joining a Twilio conference via SIP, else the
  media-stream leg; (2) the API for injecting the patient's choice into a live ElevenLabs
  conversation (mid-conversation context or user message). If either fails, Take over falls back to
  hand-back with call notes. If telephony fails entirely, run the call in the browser (a web voice
  session, where Take over means the patient joins the room), or in Relay if its agent-initiated
  calls work; both are less realistic than a real phone call.

### 7.2 FinchNode data-fit spike and fallbacks (O5)

| Need | Used by | Risk | If missing |
|---|---|---|---|
| One sandbox patient with records at both Northstar and Quillhaven | MVP 2, 5 | Scenarios may be single-provider | Best two-provider scenario; else combine two scenarios in saved data, labeled |
| Labs with codes and dates to match bill lines | MVP 1–2 | Clinical codes (LOINC) vs billing codes (CPT); dates may not line up | Demo-only lookup table; **write the bill around the patient's real lab dates** |
| Medications with status, start and end dates | MVP 5 | Status or dates absent | Mark "unconfirmed"; doctor request covers the gap |
| Trial outcome or reason stopped | MVP 5 | Likely absent (no clinical notes listed) | Expect "missing"; demo the doctor documentation request as the honest path |
| Encounters and procedures | MVP 1–2 | Not in FinchNode's listed categories | Limit record checks to labs, medications, immunizations; never claim procedure checks |
| Claims or EOB data | MVP 6 | Source-specific (likely Medicare), may be absent in the sandbox | Labeled simulated claim event |
| Provenance on every record (provider, date, record ID) | All citations | Field names unknown | Map in `lib/finchnode/`; fail visibly if absent |
| Sync timing after Connect | MVP 2 | Asynchronous arrival | "Syncing" state; saved data if slow |
| Response schema | All | Unknown until called | zod validation; save real responses as test fixtures |

**Spike results (2026-10-04, from the demo API and sandbox):** only `multi-source-overlap`
(patient "Priya Ramaswamy (synthetic)") has both Northstar and Quillhaven. It has labs with LOINC
codes and dates (TSH and free T4 at Northstar 2026-03-02; TSH at Quillhaven 2026-03-05; ferritin
and hemoglobin at Quillhaven 2025-11-20; hemoglobin at Northstar 2025-09-16), medications with
RxNorm codes and start dates (status, no end dates), conditions, immunizations, and encounters.
No claims and no documents in any scenario we checked, so claims-based case start stays simulated.
**Fixtures rebuilt around Priya (2026-10-04, `scripts/fixture-data.ts`):** Quillhaven Medical Group
bill for the 2026-03-05 endocrinology consult, $453.00 charged, $321.00 due. TSH (CPT 84443) is
billed twice (lines 3 and 5) → potential duplicate; the EOB ($253.00 owed) lists it once → bill
exceeds EOB by $68.00; free T4 (CPT 84439, line 4) has no Quillhaven record that day → documentation
gap that cites the closest free T4, Northstar's on 2026-03-02 (the cross-provider moment). Verdict:
$122.00 questioned. Mock mode now serves FinchNode's own saved records
(`fixtures/finchnode/multi-source-overlap.json`); `fixtures/records.json` is gone. CPT↔LOINC lookup:
84443↔3016-3, 84439↔3024-7, 82728↔2276-4, 85018↔718-7. Live eval on Grok: 226/226 fields.

**Spike (Dev 1, by H3):** pull all 12 sandbox scenarios and save raw responses; inventory fields;
pick the patient; write the mapping into `lib/types/`; only then write the bill, EOB, branch
documents, revised statement, and denial to match that patient's real records. Bring the open
questions to the FinchNode workshop.

---

## 8. Final demo plan

### 8.1 Setup

One synthetic patient with records at both providers (FinchNode's Priya Ramaswamy); a $321 Quillhaven
bill with a potential duplicate TSH and a free T4 with no same-day record (Northstar has one 3 days earlier); matching EOB; branch-specific supporting documents (confirms
error, disproves duplicate, needs more records); a revised statement; optional labeled new-claim
event; step therapy denial fixture for MVP 5. Teammate plays billing (and the insurer clip). Saved
sandbox data, a full screen recording, and a call recording as backups.

### 8.2 Flow (core, ~3 min; +45 s with MVP 5)

1. **Hook:** "Help me resolve this $321 bill. Don't agree to pay anything."
2. **Investigate:** records from Northstar and Quillhaven; bill and EOB confirmed; missing documents
   become tasks.
3. **Plan:** fixed rules find a potential duplicate and a documentation gap; the agent shows the
   next action, blocker, and required approval.
4. **Act:** patient approves the contact and disclosures; the agent calls billing with cited
   questions; Take over is visible.
5. **New obstacle (live):** the teammate picks a hidden branch: "those are distinct services",
   "we need the EOB", or "we need additional records".
6. **Adapt:** the agent updates the case and uses a tool (retrieve the EOB, search records, or
   prepare a request). If evidence supports distinct charges, it withdraws the duplicate concern.
   A rep's assertion alone is not proof; missing evidence leaves the issue pending.
7. **Patient steers:** iMessage explains the new blocker, answers "why?", requests approval; a
   payment-conditioned offer appears on the call screen; the "don't agree to pay" constraint holds;
   the agent asks for written terms or a callback.
8. **Continue:** returned documents rerun the checks; queued requests stay pending; simulated
   responses are labeled.
9. **Verify:** the verbal adjustment becomes a follow-up; the revised statement is compared; savings
   shown as questioned / offered / confirmed.
10. **Show the work:** goal, evidence, blocker, next action, tool results, approvals, status; the
    "What happens next?" card changes with the obstacle.
11. **(MVP 5) Denial, same case:** criteria vs records from both providers; appeal or doctor
    request; tracked deadline.
12. **Close:** the chosen pitch (§1.3). The sandbox demo proves adaptation and verification, not
    guaranteed real-world savings.

### 8.3 Live vs recorded

Live: the billing call and the agent's adaptation to the obstacle. Labeled: document-request clips,
simulated arrivals, time-compressed follow-ups, the insurer call, any submission or receipt.

### 8.4 What judges see

| Steps | Shows |
|---|---|
| 2, 6, 11 | FinchNode: working integration; records from multiple providers as evidence |
| 3, 6, 9 | Deterministic, cited findings; withdrawal on contrary evidence; verified outcome |
| 4–7 | ElevenLabs: patient-controlled live call |
| 7 | Photon: two-way iMessage with case context |
| 9 | FinTech: questioned vs confirmed savings |
| all | Neon: case, documents, events, approvals |

---

## 9. Prize targets

Verified from the MHacks Tracks & Prizes page and Devpost on 2026-10-03.

| Prize | Award | Requirement | MVP | Submission notes |
|---|---|---|---|---|
| FinchNode | Apple Watch SE3 + plan / $500 + plan / plan | Working FinchNode integration on synthetic demo records | 2 (5 strengthens) | Show live sandbox records |
| MHacks track: AI or FinTech | $2,500 | Track choice on Devpost | 2+ | *Open:* which one; whether multiple are allowed |
| Grand prize | $5,000 + ElevenLabs Pro | — | 4 | — |
| ElevenLabs (sponsor) | 3 months Scale per member | Best use of ElevenLabs | 4 | Also submit MLH ElevenLabs |
| MLH ElevenLabs | Earbuds | Use ElevenLabs | 4 | — |
| Photon | $400 + credits + interview fast-track / $200 + credits | Spectrum connected to iMessage; agent in human conversation | 3 | Must be iMessage |
| Neon | $1,000 / $500 / $100 AI Gateway credits | Neon backend used fully | 1+ (Auth in 6) | — |
| MLH Gemini | Swag | Use Gemini API | 1 | Describe extraction + drafting; record and judge the demo with `LLM_PROVIDER=gemini` and a fresh free key |
| Notability | 1 year Pro + merch | Use Notability Pro; tag it; note + 2 screenshots | 6 | Save screenshots while planning |
| MLH .Tech | Mic + domain | .tech domain | 6 | Register after naming |
| Figma Best Design | LEGO set / merch | Best design | 6 | Only if designed in Figma |
| Fetch.ai ASI:One | $1,250 / $750 / $500 | Agent on Agentverse, discoverable via ASI:One | 6 | Extra submission via ASI:One Submission Agent |
| Capital One Nessie | Gift cards + swag | Use Nessie | 6 | Only if natural |
| Judged by an LLM | LLM-chosen | — | any | Enter if free |

Skipped: Sustainability, Beyond the Code, Spacetime, SpaceXAI, Relay, FREE-WiLi, Solana, Tiger
Data, Presage, Useless AI, Dumbest Idea.

---

## 10. Research and verified facts

- **Commonwealth Fund** (insured working-age adults): 45% reported a bill or copay they thought
  should have been covered; 17% a denied doctor-recommended service; fewer than half challenged it.
- **CMS:** an EOB is not a bill; provider charges differ from patient responsibility.
- **IRS:** covered tax-exempt hospitals must have financial-assistance policies; eligibility
  depends on the policy.
- **HealthCare.gov:** certain preventive services are generally covered without cost sharing in
  network (not "all physicals and screenings are free").
- **Appeals and disputes:** disputing a bill is free; internal insurance appeals are free under the
  ACA for most plans; Medicare appeals are free through the administrative levels; external review
  is usually free (some state programs charge up to $25, refunded on a win). Re-verify before
  quoting.
- **Reel research** (team's Muse summaries; reels not verified): themes of cost anxiety, insurer
  friction, fragmented pricing, confusing charges. Product implications adopted: one calm next step,
  denial reasons as evidence checklists, separate provider bills, show charge/adjustment/patient
  responsibility first, financial-assistance referral, "why was this flagged?" over iMessage,
  written outcomes and follow-ups.
- **Possible hook (read before quoting):** a CNBC article dated 2026-10-01 reports a health
  insurer blaming AI for nearly $1 billion in questionable hospital charges ("AI is already on both
  sides of your bill; now patients get one too").
- **Keep out of the pitch until sourced:** "up to 80% of bills contain errors", the ER violence and
  Canadian waitlist figures, individual dollar anecdotes, "never pay the first number" (reframe as
  review, compare, contact), guaranteed discounts or payment plans, clinical advice.
- **Suggested patient research:** walk through a recent bill or denial; test with a balance
  statement, an itemized bill plus EOB, and a denial with incomplete records.

---

## 11. FinchNode reference

Verified from finchnode.com on 2026-10-02 plus workshop notes.

- Read-only, patient-authorized US records across 17 EHR/payer families; hosted Connect; TEFCA
  mentioned at the workshop; a FinchNode MCP exists (listed unhealthy on 2026-10-02).
- API: `/users/{subject}/records` (current); `/patients` routes are legacy.
- Data: demographics, medications, conditions, allergies, vitals, labs, immunizations,
  source-specific coverage and claims.
- Free plan: synthetic sandbox (12 scenarios from Northstar Health System and Quillhaven Medical
  Group), hosted consent, scheduled sync, signed webhooks.
- Judging note from the workshop: "What are you doing with the data? New perspective."
- *Open:* response schema; medication status, dates, and outcomes; claims beyond Medicare and in
  the sandbox; the best scenario for both the bill dispute and the step therapy denial.

---

## 12. Open decisions and conflicts

1. **Conflict between the team's tabs:** "Demo Flow" makes denial appeals a stretch; "Competitors &
   Differentiation" recommends building one denial appeal and one bill correction. This spec builds
   the bill dispute first (MVP 2–4) and the denial appeal next (MVP 5). Decide by H12 whether MVP 5
   is required for the final demo.
2. **Pitch:** agent framing or evidence framing (§1.3).
3. **MHacks track:** AI or FinTech, and whether multiple entries are allowed.
4. **Take over:** warm transfer or hand-back with notes (O2).
5. **Call consent model** for real-world use.
6. **Login:** Neon Auth or one demo user.
7. **Worker hosting** during judging.
8. **Coding-mismatch rule:** include only if simple and defensible.
9. **File storage** for documents.
10. **Product name.**
11. **Team language skills (unconfirmed):** the stack assumes everyone can work in TypeScript.
    If not, decide by H1 whether to move the backend to Python (FastAPI) and keep a light React
    frontend.
12. **Real timeline (unconfirmed):** MVP targets assume hacking started Sat 12:00 PM. Record the
    actual start time and the Devpost submission deadline here and shift §6 targets accordingly.
13. **Owners (unconfirmed):** assign real names to Dev 1–4 in §6.
14. **Repo access:** add every teammate as a collaborator on the private GitHub repo.
15. ~~**AI model**~~ Decided (§5.1): Grok `grok-4.20-0309-non-reasoning` for development (xAI credits; Gemini's free tier is 20 requests/day and paid billing needed a $30 prepay), Gemini `gemini-3.5-flash` pinned for the judged demo so the MLH Gemini entry holds. Switch with `LLM_PROVIDER`.
16. **Archived Google Doc tabs:** keep "Demo Flow (archived)" and "Stack (archived)" for reference
    or delete them to prevent edits to the old copy.

---

## 13. Team workflow

Each task runs through four phases, each in a fresh session with its prompt from `prompts/`:
Plan (`prompts/PLAN.md` → `agent-notes/<task>/PLAN.md`), Implement (`IMPLEMENTATION.md`), Audit
(`AUDIT.md`), Test (`TEST_RESULTS.md`). Name tasks after MVP rungs, e.g. `mvp1-audit-rules`,
`mvp2-agent-loop`. Known bugs and fixes are logged in `CLAUDE.md`.

---

## 14. Source map

| Section | Merged from |
|---|---|
| §1 | spec/PROJECT.md (product, pipeline, positioning); Doc "Demo Flow" (agent framing, pitch); Doc "Competitors & Differentiation" (competitors, what we do better, evidence pitch) |
| §2 | spec/PROJECT.md core invariant; Doc "Demo Flow" core rule and permissions; Doc "Competitors" (potential vs confirmed); AGENTS.md rules |
| §3 | Doc "Demo Flow" (agent loop, tools, branches, waiting/resuming, success checks, routing) |
| §4 | spec/PROJECT.md features; Doc "Demo Flow" workflow additions and card; Doc "Muse Reel Research Review" (intake and display implications) |
| §5 | AGENTS.md; spec/PROJECT.md stack; Doc "Stack" |
| §6–§7 | New (built from all sources) |
| §8 | Doc "Demo Flow" demo flow, setup, live vs recorded; spec/PROJECT.md judging map |
| §9 | Doc track tabs; MHacks Tracks & Prizes page; Devpost |
| §10 | Doc "Muse Reel Research Review"; spec/PROJECT.md background facts; Doc "FinchNode" team notes |
| §11 | spec/PROJECT.md; Doc "FinchNode" |
| §13 | CLAUDE.md |
