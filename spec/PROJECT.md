# Project spec — AI medical bill auditor and patient advocate (working name)

MHacks 2026, Oct 3–4, Ann Arbor. 4 developers, ~24 hours. Primary target: the FinchNode prize.
Secondary: 2nd/3rd-place sponsor prizes from supporting integrations.

Status: **working draft**, aligned with the team's notes in the MHacks 2026 Google Doc. Items
marked *Open* are not decided — do not treat them as requirements. Update this file when the team
decides something.

## Product

One agent that handles the whole case of a medical bill, from the first bill to the final appeal.
It gets the itemized bill, audits it, disputes and negotiates it with the billing office, and if
the insurer denies the claim, it appeals the denial with evidence from the patient's records. A
human can step in at every stage: the patient approves or takes over each step by text or on a live
call screen. Every document in the case is tracked from request to response.

### The pipeline

```
Case starts (bill shared, or new claim detected)
  -> request the itemized bill          (phone call to billing office, or letter)
  -> audit the itemized bill            (deterministic rules + records)
  -> dispute and negotiate the bill     (phone call, then written dispute for the record)
  -> insurer denies a claim
  -> investigate the denial             (phone call to insurer: exact reason, policy criteria)
  -> written appeal with evidence       (records from every provider, each cited)
  -> track deadlines, escalate if needed (external review)
```

The case stays connected: evidence, claim details, and call outcomes gathered for the bill carry
into the denial appeal, so the patient never starts over or re-explains anything.

### Positioning

Most tools handle one step: bill tools (MyMedBill, AiMyClaims, CareRoute) work on the bill;
appeal tools (Counterforce Health, Claimable, FightHealthInsurance) work on denials and make the
patient gather and upload their own records. We handle the whole case, pull the records from every
provider automatically through FinchNode, and keep the patient in control of every call. Do not
claim to be the only tool doing this; the space moves fast.

Pitch: "Most tools fix one step. We handle the whole case, from the first bill to the final
appeal, with your records pulled automatically."

### Why FinchNode is essential

- **Appeals:** an appeal is won with medical evidence spread across every provider the patient has
  seen. FinchNode is the only source of it here; without records there is no appeal.
- **Bill audit:** records let the app ask "was this actually done?" for charges such as labs and
  medications.

This answers FinchNode's judging question ("what are you doing with the data? new perspective"):
records used as evidence against a bill or an insurer, not just viewed.

## Core invariant: AI never writes or interprets a health fact, or invents a finding

This is the project's central design rule and the main thing the audit and test phases must
enforce.

- **Health facts are verbatim.** Every health fact in a letter, script, call, or on screen is
  copied exactly from a FinchNode record with its source attached (provider + date). An LLM never
  writes, summarizes, paraphrases, or infers a health fact.
- **Findings are deterministic.** Bill-audit flags and appeal evidence come from fixed rules and
  lookup tables in code, never from LLM judgment. Every finding cites the bill line, EOB line, or
  record it is based on.
- **Missing is not wrong.** A charge with no matching record is phrased as a documentation request
  ("please provide documentation for this charge"), never as "you were overcharged".
- **The AI only does paperwork and conversation.** It may read uploaded documents (extraction the
  patient confirms), draft prose around the verbatim findings, and speak a script on calls. It
  cannot add findings or health claims.
- **The patient decides.** Nothing is sent, submitted, or agreed to on a call without the patient's
  explicit approval (A/B replies count). No medical advice, diagnosis, or treatment suggestions.
- **A human can take over at every step.** Every stage of the pipeline has a handoff point (see
  "Human handoff"). When the agent is unsure, out of script, or asked for something only the
  patient can give, it stops and hands off instead of guessing.

## Features

### Shared

1. **Connect records** — FinchNode hosted Connect flow.
2. **Case start** — two entry points:
   - **Share a document:** itemized bill, EOB (explanation of benefits), or denial letter, as PDF or
     photo, uploaded or shared from the portal in one tap (PWA share target; the iMessage thread as
     a fallback). An LLM extracts structured fields; the patient confirms or corrects every field
     before it is used.
   - **Claim detected:** when FinchNode claims or coverage data shows a new claim (via scheduled
     sync or signed webhook), the agent opens a case and offers to request the itemized bill.
     *Open:* whether FinchNode exposes claims beyond Medicare and whether the sandbox includes
     claims; if not, the demo simulates this trigger from a fixture.
   - Patients cannot be logged into their portals by the app (no stored portal passwords or
     scraping).
3. **Case tracking** — each bill or denial is a case with status, deadlines, and history.
4. **Text updates and decisions (Photon)** — status texts plus "reply A or B" choices for next
   actions (e.g. "A: send the dispute email, B: call the billing office").

### Bill audit

5. **Audit rules** (deterministic):
   - duplicate charges (same code, date, and amount)
   - coding mismatches (*Open:* which checks are feasible in 24 hours; e.g. a code inconsistent
     with the setting or quantity)
   - out-of-network charges where the No Surprises Act may apply (e.g. emergency care)
   - bill vs. EOB: billed patient responsibility exceeds what the EOB says the patient owes
   - bill vs. records: lab or medication charges with no matching FinchNode record, using a lookup
     table from billing code to record type for the demo codes
6. **Dispute draft** — patient-friendly email to the billing office, with each finding cited.
   Also suggests requesting an itemized bill, financial assistance (charity care), or a payment plan
   where relevant. Reference: CMS medical bill rights (cms.gov/initiatives/your-patient-rights).

### Denial appeals

7. **Classify the denial** — map the confirmed denial reason to a supported type; if unsupported,
   say so plainly.
8. **Match criteria to evidence** (deterministic), hackathon scope. The insurer's criteria come
   from the confirmed denial letter and the insurer call (patient confirms them). Each criterion is
   checked against the records and marked **met** (with the records that support it), **missing**
   (with exactly what is needed), or **unconfirmed**:

   | Denial reason | Criterion is met only when the records show | FinchNode data |
   |---|---|---|
   | Step therapy ("try cheaper drugs first") | For each required drug: it was prescribed, **and** the trial is documented (start and end dates or duration, and the outcome or reason it stopped, such as ineffective or side effects) | Medications, plus notes/conditions where available |
   | Not medically necessary | Each policy criterion for the denied service is supported by a documented condition, lab result, or prior treatment, via a lookup table | Conditions, labs, medications |

   **A prescription or a stopped medication alone does not prove the required trial was completed.**
   "Prescribed, then discontinued" with no documented duration or outcome is marked **missing**,
   not met.
9. **Next action** (deterministic routing from the confirmed denial, plan documents, and the
   criteria results):
   - **All criteria met:** prepare the cited appeal for patient review.
   - **Some criteria missing:** prepare a specific documentation request to the treating provider
     (e.g. "treatment dates and outcome for medication A"), which the patient reviews and approves,
     and add it to the paperwork tracker. Do not draft a weak appeal.
   - **Unsupported denial type or nothing usable:** say so plainly and offer handoff.
   - The app shows a **"What happens next?" card**: next action, why (citing the records and the
     gap), what is needed, responsible party, deadline (from the confirmed denial notice; shown as
     unconfirmed if unavailable), and a button to review the request or appeal.
10. **Appeal draft** — when criteria are met, the LLM writes the letter with placeholders; code
    inserts each verbatim evidence item and its source, criterion by criterion ("Insurer requires X;
    records show Y"). Includes the appeal deadline and where to send it. Patient reviews, approves,
    and downloads a PDF. Status moves through draft ready, patient approved, submitted, receipt
    confirmed, and decision received; **a downloaded PDF is not proof of submission**.

### Human handoff (every step)

Every pipeline stage has the same three handoff mechanisms:

- **Approval gate:** the agent prepares the next action and waits for the patient's approval
  (button in the app or reply in iMessage) before it calls, sends, or submits anything.
- **Take over:** the patient can take any step themselves at any time. Drafts are editable and
  downloadable; tasks can be marked "I'll do this myself"; on a live call, a **Take over** button
  patches the patient into the call (warm transfer via a Twilio conference) and the agent drops
  off or stays silent as a note-taker.
- **Automatic escalation:** the agent hands off on its own when it should not continue: the
  billing office or insurer requires identity verification or the patient's own authorization; the
  rep asks something outside the script's findings; the denial type is unsupported or no evidence
  is found; extraction is low-confidence or contradicts records; a deadline is too close to wait;
  or the patient doesn't answer a mid-call decision in time.

| Stage | Approval gate | Typical escalation |
|---|---|---|
| Case start | Confirm the case and the request for the itemized bill | Claim data unclear or missing |
| Itemized bill request | Approve the call or letter | Office requires the patient's verification |
| Audit | Confirm extracted fields; review findings | Low-confidence extraction |
| Dispute and negotiation | Approve the call or email; choose options mid-call | Off-script question, offer outside the options, timeout |
| Denial investigation | Approve the call to the insurer | Insurer requires the member to call |
| Written appeal | Review, edit, and approve before sending | Unsupported denial type, no evidence |
| Escalation (external review) | Approve filing | Always patient-led; app prepares the paperwork |

Every handoff is logged in the case timeline (who acted, when, and what was decided).

### Paperwork tracker

Each case keeps a register of every document, in and out, so the patient always knows what has
been requested, received, sent, and what is still owed:

- **Documents tracked:** claim or EOB, itemized bill, written dispute, billing office written
  confirmations or revised bills, denial letter, appeal letter, insurer acknowledgement and
  decision, external review filing, call transcripts and call summaries.
- **For each document:** type, direction (incoming or outgoing), status (requested, received,
  drafted, approved, sent, acknowledged, awaiting response, resolved), dates, method (call, email,
  mail, fax, portal), counterparty, reference or claim number, the file itself, and the findings or
  records it cites.
- **Deadlines and follow-ups:** each document can carry a deadline (e.g. the appeal filing deadline
  from the denial letter, the insurer's response window) and a follow-up date. Photon texts the
  patient before deadlines and when a response is overdue; the agent proposes the follow-up call or
  letter and waits for approval.
- **Case timeline:** one chronological view of documents, calls, decisions, and handoffs across the
  whole pipeline, from claim to final appeal.
- **Export:** the patient can download the full case packet (all documents plus the timeline) at
  any time, e.g. to give to a human advocate or attach to an external review.
- *Open:* exact deadline rules per plan type; for the demo, take deadlines from the confirmed denial
  letter fields rather than computing them.

### Phone advocacy (ElevenLabs)

Phone calls and written documents have different jobs:

| Step | Channel | Role of the voice agent |
|---|---|---|
| Request the itemized bill | Phone (or portal message / letter) | Makes the short, routine request |
| Dispute errors on the bill | Phone first, then **written dispute** for the record | Flags errors and asks for corrections; the app sends the written dispute after |
| Negotiate the bill (discounts, payment plans, charity care) | **Phone** | Main channel; the patient steers live |
| Investigate a denial | Phone to the insurer | Gets the exact denial reason, claim details, and the policy criteria that apply; feeds the written appeal; later checks appeal status |
| Appeal the denial | **Written** (letter, fax, or insurer portal) | None on the appeal itself; formal appeals are generally written (some urgent appeals can be started by phone; rules vary by plan) |
| External review | Written | None |

11. **Call script** — generated from the same verbatim findings, per call type (itemized bill
    request, bill negotiation, denial investigation).
12. **Voice call** — an ElevenLabs voice agent calls the billing office or insurer using the
    script. Billing offices usually verify identity and need the patient's authorization; *Open:*
    whether the patient joins the call or consents at the start. For the demo, a teammate plays the
    billing office.
13. **Live decisions during the call** — the patient steers the call while it happens:
    - The app shows a **live call screen**: status, a running transcript, and decision prompts.
    - When the rep says something that needs a decision (e.g. "we can offer 20% off if you pay
      today, or set up a payment plan"), the agent calls a tool (e.g. `ask_patient(question,
      options)`), tells the rep "one moment while I check with the patient", and the patient sees
      2–4 options as buttons (e.g. "Accept 20% off", "Ask for 40%", "Request payment plan", "Ask
      them to email the offer").
    - The patient's choice is returned to the agent, which continues the call accordingly. The
      patient can also send a short custom instruction.
    - **Photon fallback:** if the patient isn't on the call screen, the same prompt goes out as a
      text ("Reply A, B, or C").
    - **Timeout:** if no answer arrives in time, the agent does not agree to anything; it asks for
      the offer in writing or a callback.
    - Options are generated from the case's findings and what the rep said; the agent cannot commit
      to anything (payment, settlement, sharing information) the patient hasn't chosen.
    - *Open:* verify ElevenLabs tool-call timeout limits for a human-in-the-loop wait, and the
      transport for the live screen (server-sent events or websockets; Vercel functions may need a
      hosted realtime service or the Node worker).

## Stack (proposed)

| Layer | Choice |
|---|---|
| App | Next.js (TypeScript, App Router), mobile-first web app, installable as a PWA (manifest + icon) so it opens full-screen from the home screen |
| Native app | Optional, only if time allows at the end: wrap the same web app with Capacitor for iOS/Android. No separate native codebase |
| UI | Tailwind + shadcn/ui |
| Hosting | Vercel |
| Database | Neon Postgres + Drizzle ORM |
| Records | FinchNode REST API, server-side only, with a `USE_MOCK` switch to saved sandbox data |
| LLM | Google Gemini API (via `lib/llm/` only): reads bills, EOBs, and denial letters (PDF and photo input) into zod-validated structured output; drafts letters and scripts with placeholders. Qualifies for the MLH Gemini prize. *Open:* test early on our scanned sample bills and photos |
| Rules engine | Pure TypeScript functions in `lib/audit/` and `lib/evidence/`, tested with Vitest |
| Letter PDF | `@react-pdf/renderer` |
| Texts | Photon `spectrum-ts` in a long-running Node worker (not serverless): sends updates, receives A/B replies |
| Voice | ElevenLabs Conversational AI + Twilio for outbound calls: itemized bill requests and negotiation with billing offices, denial investigation with insurers; an `ask_patient` server tool that waits for the patient's choice |
| Live call screen | Transcript + decision buttons + Take over button pushed to the browser (SSE/websockets via the Node worker or a hosted realtime service); Take over uses a Twilio conference to patch the patient in |
| Paperwork tracker | `documents`, `deadlines`, and `case_events` tables in Neon; files in object storage (*Open:* Vercel Blob or similar); timeline built from `case_events` |
| Stretch | Fetch.ai uAgent (Python) on Agentverse, reachable from ASI:One, calling the app's API |
| Auth | Neon Auth if time allows, otherwise one hardcoded demo user |

Why web first: judges open a URL instantly; one codebase and one deploy (the backend must be
server-side anyway); Photon's iMessage agent already gives the patient an app-like channel for
updates and decisions; camera upload, the live call screen, and PDF download all work in a mobile
browser; no app store, signing, or device setup during the hackathon.

```
app/                 pages + API routes
lib/finchnode/       API client + mock switch
lib/extract/         document parsing (Gemini) + confirmation flow
lib/audit/           bill-audit rules + lookup tables (+ tests)
lib/evidence/        denial-appeal evidence rules + lookup tables (+ tests)
lib/draft/           letter/email/script drafting, verbatim insertion, PDF
lib/cases/           pipeline stages, handoff rules, paperwork tracker, deadlines
db/                  Drizzle schema
fixtures/            mock sandbox data, sample bill, EOB, denial letter
workers/photon/      text worker
voice/               ElevenLabs agent config + Twilio glue
agents/fetch/        Python uAgent (stretch)
```

## Background facts (for the pitch; re-verify before quoting)

- Disputing a bill with a hospital is free; internal insurance appeals are free under the ACA for
  most plans; Medicare appeals are free through the administrative levels.
- Do not quote reel statistics (e.g. "80% of bills contain errors") without a solid source; use
  sourced figures such as KFF's analysis of denials and appeals.
- Competitors (checked 2026-10-03): Counterforce Health (denial appeals with voice AI; patient
  uploads records), Claimable (appeal letters, about $40), FightHealthInsurance.com (free appeals;
  patient types their history), Dollar For (charity care), MyMedBill, AiMyClaims, Medical Bill
  Negotiator: IQ, CareRoute Bill Defense (bill disputes and negotiation). Provider-side voice agents
  (Cedar Kora, Collectly Billie, Infinitus, Prosper AI) work for hospitals and insurers, not
  patients. See "Positioning" above.

## FinchNode (verified from finchnode.com, 2026-10-02)

- Read-only, patient-authorized US health records across 17 EHR/payer families. Team workshop
  notes mention TEFCA and the FinchNode MCP.
- Normalized API: `/users/{subject}/records` (current); `/patients` routes are legacy.
- Data categories: demographics, medications, conditions, allergies, vital signs, labs,
  immunizations, source-specific coverage and claims.
- Free plan: synthetic sandbox (12 named scenarios from **Northstar Health System** and
  **Quillhaven Medical Group**, no auth needed), hosted consent, scheduled sync, signed webhooks.
- *Open:* response schema; whether medications include discontinued status and dates; whether
  claims data is available beyond Medicare; which sandbox scenario fits the demo; whether the MCP is
  usable (listed as unhealthy on 2026-10-02).

## Supporting sponsors

| Sponsor | Role |
|---|---|
| Photon | Text updates and A/B decisions |
| ElevenLabs | Voice agent that calls the billing office or insurer |
| Google Gemini (MLH) | Document reading and drafting |
| Neon | Database |
| Fetch.ai | Stretch: agent reachable from ASI:One |
| Capital One | *Open:* savings angle (money recovered), only if natural |

Not used: Relay (we use Photon for messaging instead), SpaceXAI and Grok (we use Gemini), Spacetime, FREE-WiLi, Solana,
Tiger Data, Presage. See the track tabs in the MHacks 2026 Google Doc for each decision.

## Demo

### Setup

- Runs fully on the FinchNode synthetic sandbox; no real patient data. Keep a local mock
  (`USE_MOCK=true`) so the demo survives API or network issues, but show live sandbox records when
  the network allows (FinchNode judges want a working integration).
- Fixtures matched to one sandbox patient with records at both providers (Northstar Health System
  and Quillhaven Medical Group): an itemized bill with a planted duplicate charge and a lab charge
  with no matching result, an EOB, and a step therapy denial letter whose required drugs appear as
  discontinued in that patient's records.
- One teammate plays the hospital billing office on a real phone.
- Backups: a screen recording of a good run, and a pre-recorded call in case the live call fails.

### Flow (about 3.5 minutes)

1. **Hook (15 s).** "Most tools fix one step of a medical bill. A bill is a whole case: getting the
   itemized bill, fighting the charges, then fighting the insurer."
2. **Connect records.** FinchNode Connect on the sandbox; records arrive from both Northstar and
   Quillhaven.
3. **Case starts.** A new claim appears (live from FinchNode if available, otherwise a simulated
   claim event). The agent texts: "Your Northstar ER visit was billed $X. Want me to request the
   itemized bill?" Reply YES.
4. **Itemized bill request (short call).** The agent calls the billing office and requests the
   itemized bill. Show a short clip or transcript to save time. The bill "arrives" and the patient
   shares it into the app in one tap, then confirms the fields the app read.
5. **Audit findings.** Flags appear, each citing its source: a duplicate charge (two bill lines)
   and a lab charge with no matching result in any record, phrased as a documentation request. A
   running total shows the dollars in dispute.
6. **Two-way iMessage (Photon).** The patient asks "why is the lab charge flagged?" and gets an
   answer citing the bill line and the records searched, then replies B to "A: email the billing
   office, B: call them."
7. **Live negotiation call (the highlight).** The voice agent calls the teammate playing the
   billing office. The rep offers 20% off for paying today; options pop up; the patient taps "Ask
   for 40%"; the agent counters. The rep agrees to remove the duplicate and review the lab charge;
   the agent asks for it in writing, and the app sends the written dispute for the record. Point
   out the Take over button, available throughout the call.
8. **Savings and paperwork.** The case screen updates the total saved (FinTech angle), and the
   paperwork tracker shows every document so far (claim, itemized bill, written dispute, the
   billing office's written confirmation) with status and dates.
9. **Denial, same case.** The insurer denies a related prescription (step therapy). The agent calls
   the insurer (short clip) and gets the exact denial reason and policy criteria, which the patient
   confirms. The app shows "Insurer requires X → records support Y → Z is missing" with cited
   records from both providers. If the evidence is sufficient, it prepares the cited appeal for
   review; if not, it shows the "What happens next?" card with a documentation request to the
   doctor. Either item and its deadline appear in the paperwork tracker. Point out that nothing had
   to be re-entered.
10. **Close (15 s).** "One agent, one case, from the first bill to the final appeal." The AI never
    invents a fact; every claim traces to a bill line or a record.

Only the negotiation call (step 7) is live; the itemized bill request and the insurer call are
short pre-recorded clips or transcripts, to keep the demo on time and reduce risk.

### What each moment shows judges

| Step | Shows |
|---|---|
| 2, 3, 9 | FinchNode: working integration; claims start the case; records from multiple providers used as evidence |
| 5 | Deterministic, cited findings (trustworthy AI) |
| 3, 6, 9 | Photon: two-way iMessage agent that remembers the case across bill and denial |
| 4, 7, 9 | ElevenLabs: voice agent for every call in the pipeline, with the patient in control mid-call |
| 8 | FinTech: money saved |
| All | Neon backs cases, findings, and call decisions |

## Open

- Product name.
- Team split across the 4 developers.
- Coding-mismatch rules and lookup tables for the demo fixtures.
- Call consent model, and whether Take over is a warm transfer or a hand-back with call notes.
- Whether official MHacks prize rules (announced at opening ceremony) change any of the above.
