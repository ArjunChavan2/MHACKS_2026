# Project spec — AI medical bill auditor and patient advocate (working name)

MHacks 2026, Oct 3–4, Ann Arbor. 4 developers, ~24 hours. Primary target: the FinchNode prize.
Secondary: 2nd/3rd-place sponsor prizes from supporting integrations.

Status: **working draft**, aligned with the team's notes in the MHacks 2026 Google Doc. Items
marked *Open* are not decided — do not treat them as requirements. Update this file when the team
decides something.

## Product

The patient uploads a medical bill or an insurance denial letter. The app finds what's wrong,
then fights it for them: it drafts the dispute or appeal, can make the phone call, and keeps the
patient updated by text.

Two modes, one engine:

1. **Bill audit (base product).** Upload an itemized bill. Fixed rules flag questionable charges:
   duplicates, coding mismatches, out-of-network surprises, charges inconsistent with the
   insurer's explanation of benefits, and charges with no matching medical record.
2. **Denial appeals (differentiator).** Upload a denial letter. The app pulls the evidence from the
   patient's medical records across every provider and drafts an appeal that cites it.

Pitch: "Appealing is free. Winning takes evidence. We bring the evidence."

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

## Features

### Shared

1. **Connect records** — FinchNode hosted Connect flow.
2. **Upload documents** — itemized bill, EOB (explanation of benefits), or denial letter, as PDF or
   photo. An LLM extracts structured fields; the patient confirms or corrects every field before
   it is used.
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
8. **Gather evidence** (deterministic), hackathon scope:

   | Denial reason | Evidence rule | FinchNode data |
   |---|---|---|
   | Step therapy ("try cheaper drugs first") | Required drugs that were prescribed and are now discontinued, at any provider | Medications |
   | Not medically necessary | Documented conditions and labs relevant to the denied service, via a lookup table | Conditions, labs |

   If no evidence is found, say so; do not draft an appeal without evidence.
9. **Appeal draft** — the LLM writes the letter with placeholders; code inserts each verbatim
   evidence item and its source. Includes the appeal deadline and where to send it. Patient reviews,
   approves, and downloads a PDF.

### Phone advocacy (ElevenLabs)

10. **Call script** — generated from the same verbatim findings.
11. **Voice call** — an ElevenLabs voice agent calls the billing office or insurer using the
    script. Billing offices usually verify identity and need the patient's authorization; *Open:*
    whether the patient joins the call or consents at the start. For the demo, a teammate plays the
    billing office.
12. **Live decisions during the call** — the patient steers the call while it happens:
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
| App | Next.js (TypeScript, App Router), mobile-first web |
| UI | Tailwind + shadcn/ui |
| Hosting | Vercel |
| Database | Neon Postgres + Drizzle ORM |
| Records | FinchNode REST API, server-side only, with a `USE_MOCK` switch to saved sandbox data |
| LLM | Grok (xAI is a sponsor): Files API for parsing bills, EOBs, and denial letters; drafting letters and scripts. *Open:* confirm the Files API handles scanned PDFs and photos |
| Rules engine | Pure TypeScript functions in `lib/audit/` and `lib/evidence/`, tested with Vitest |
| Letter PDF | `@react-pdf/renderer` |
| Texts | Photon `spectrum-ts` in a long-running Node worker (not serverless): sends updates, receives A/B replies |
| Voice | ElevenLabs Conversational AI + Twilio for outbound calls; an `ask_patient` server tool that waits for the patient's choice |
| Live call screen | Transcript + decision buttons pushed to the browser (SSE/websockets via the Node worker or a hosted realtime service) |
| Stretch | Fetch.ai uAgent (Python) on Agentverse, reachable from ASI:One, calling the app's API |
| Auth | None for the demo; one hardcoded demo user |

```
app/                 pages + API routes
lib/finchnode/       API client + mock switch
lib/extract/         document parsing (Grok) + confirmation flow
lib/audit/           bill-audit rules + lookup tables (+ tests)
lib/evidence/        denial-appeal evidence rules + lookup tables (+ tests)
lib/draft/           letter/email/script drafting, verbatim insertion, PDF
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
- Competitors: FightHealthInsurance.com (appeals; the user supplies their own history), Dollar For
  (charity care). Ours pulls the evidence from records automatically.

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
| xAI (Grok) | Document parsing and drafting |
| Neon | Database |
| Fetch.ai | Stretch: agent reachable from ASI:One |
| Capital One | *Open:* savings angle (money recovered), only if natural |

## Demo

- Runs fully on the FinchNode synthetic sandbox; no real patient data. Keep a local mock so the
  demo survives API or network issues.
- Create fixtures that match one sandbox patient: an itemized bill with a planted duplicate and a
  lab charge with no matching result, an EOB, and a step therapy denial letter.
- Flow: connect records → upload bill → flags with citations → dispute email drafted → text "A:
  email, B: call" → reply B → voice agent calls a teammate playing the billing office → the
  "rep" offers a discount → options pop up on the live call screen → patient taps "Ask for 40%" →
  the agent counters on the call → then
  upload the denial letter → evidence from records → appeal letter with each record cited.

## Open

- Product name.
- Team split across the 4 developers.
- Coding-mismatch rules and lookup tables for the demo fixtures.
- Call consent model.
- Whether official MHacks prize rules (announced at opening ceremony) change any of the above.
