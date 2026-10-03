# Project spec — Denial Appeals (working name)

MHacks 2026, Oct 3–4, Ann Arbor. 4 developers, ~24 hours. Primary target: the FinchNode prize.
Secondary: 2nd/3rd-place sponsor prizes from supporting integrations.

Status: **working draft**. Items marked *Open* are not decided — do not treat them as
requirements. Update this file when the team decides something.

## Product

An app that fights health insurance denials for you. The patient uploads (or photographs) their
denial letter. The app reads the denial reason, pulls the patient's medical records from every
provider through FinchNode, finds the records that answer that reason, and drafts an appeal letter
that cites each one. The patient reviews and sends it.

Pitch: "Appealing is free. Winning takes evidence. We bring the evidence."

### Why FinchNode is essential

An appeal is won with medical evidence, and that evidence is spread across every provider the
patient has seen. FinchNode is the only source of it in this product: without records there is no
evidence and no appeal. This answers FinchNode's judging question ("what are you doing with the
data? new perspective"): records used as evidence against an insurer, not just viewed.

## Core invariant: AI never writes or interprets a health fact

This is the project's central design rule and the main thing the audit and test phases must
enforce.

- **Health facts are verbatim.** Every health fact in an appeal or on screen is copied exactly
  from a FinchNode record with its source attached (provider + date). An LLM never writes,
  summarizes, paraphrases, or infers a health fact.
- **Evidence selection is deterministic.** Which records count as evidence for a denial type is
  decided by fixed rules in code (see "Denial types"), not by an LLM.
- **The AI only does paperwork.** It may read the denial letter (extraction, confirmed by the
  patient), draft the letter's non-clinical prose around the verbatim evidence, and suggest
  deadlines and next steps.
- **Every claim in the letter is backed.** Each statement about the patient's history references
  a specific record; the letter contains no health claim without one.
- **The patient decides.** The app never sends anything without the patient's review and
  approval, and gives no medical advice, diagnosis, or treatment suggestions.

## Denial types (hackathon scope: these two)

| Denial reason | Evidence rule | FinchNode data |
|---|---|---|
| **Step therapy** ("try cheaper drugs first") | Find medications in the insurer's required list that the patient was prescribed and that are now discontinued, at any provider | Medications |
| **Not medically necessary** | Find documented conditions and lab results relevant to the denied service, using a lookup table from service to qualifying conditions/labs | Conditions, labs |

The required-drug list (step therapy) and the service lookup table (medical necessity) only need to
cover the demo scenarios. *Open:* exact entries, chosen once the sandbox scenario is picked.

Out of scope for the demo: other denial types, external review filing, bill error checking (a
possible secondary feature later).

## Features

1. **Connect records** — FinchNode hosted Connect flow (patient finds provider, authenticates
   with that provider directly, consents).
2. **Upload denial letter** — PDF or photo. An LLM extracts: insurer, claim/reference number,
   denied service or drug, denial reason, date, appeal deadline, and where to send the appeal. The
   patient confirms or corrects every extracted field before anything else happens.
3. **Classify the denial** — map the confirmed denial reason to one of the supported denial types.
   If it matches neither, say so plainly rather than drafting a weak appeal.
4. **Gather evidence** (deterministic) — apply the denial type's evidence rule to the patient's
   FinchNode records. Show the patient each evidence item, verbatim with its source. If no
   evidence is found, say so; do not draft an appeal without evidence.
5. **Draft the appeal** — an LLM writes the letter's structure and prose (request, claim
   reference, explanation of why the denial should be reversed) using placeholders for each
   evidence item; code inserts the verbatim evidence and source into each placeholder. Output
   includes the appeal deadline and where to send it.
6. **Review and send** — the patient edits and approves the letter, then downloads it (PDF) to
   submit. Track the case: submitted date, deadline, status.
7. **Updates** — text the patient when the appeal is ready and before the deadline.

### Optional / stretch

- Voice agent (ElevenLabs) that calls the insurer to check appeal status.
- Fetch.ai agent on Agentverse reachable from ASI:One ("appeal my denial").
- Guidance on external review if the internal appeal is denied (free in most cases; some state
  programs charge up to $25, refunded on a win).

## Background facts (for the pitch; re-verify before quoting)

- Internal appeals are free under the ACA for most plans; Medicare appeals are free through the
  administrative levels.
- Many denials are never appealed. Use a sourced figure (e.g. KFF's analysis of ACA marketplace
  denials and appeals), not reel statistics.
- Competitors: FightHealthInsurance.com (appeal drafting; the user supplies their own history),
  Dollar For (charity care). Ours pulls the evidence from records automatically.

## FinchNode (verified from finchnode.com, 2026-10-02)

- Read-only, patient-authorized US health records across 17 EHR/payer families (Epic, Oracle
  Health, athenahealth, eClinicalWorks, MEDITECH, Veradigm, Medicare, ...). Team notes from the
  workshop mention TEFCA and the FinchNode MCP.
- Normalized API: `/users/{subject}/records` (current); `/patients` routes are legacy.
- Data categories: demographics, medications, conditions, allergies, vital signs, labs,
  immunizations, source-specific coverage and claims.
- Free plan: synthetic sandbox (12 named scenarios from two synthetic sources, **Northstar Health
  System** and **Quillhaven Medical Group**, no auth needed), hosted consent, scheduled sync,
  signed webhooks.
- *Open:* exact response schema; whether medication records include discontinued status and
  dates; which sandbox scenario has a medication history that fits a step therapy denial; whether
  the FinchNode MCP is usable (it was listed as unhealthy on 2026-10-02).

## Supporting sponsors

| Sponsor | Role |
|---|---|
| Photon (Spectrum SDK) | iMessage/WhatsApp updates: appeal ready, deadline reminders |
| Neon | Serverless Postgres: users, cases, extracted denial fields, evidence, letters |
| ElevenLabs | Stretch: voice agent that calls the insurer |
| Fetch.ai | Stretch: appeal agent on Agentverse reachable from ASI:One |
| Capital One | *Open:* possible savings angle (money recovered); only if it fits naturally |

Skipped: SpacetimeDB, Freesolo, Relay, FREE-WiLi, Meta, Supabase.

## Demo

- Runs fully on the FinchNode synthetic sandbox; no real patient data.
- Keep a local mock of the sandbox data so the demo survives API or network issues.
- Create a fake denial letter that matches one sandbox patient (e.g. a step therapy denial for a
  drug whose required alternatives appear as discontinued in that patient's records).
- Flow: connect records → upload denial letter → confirm extracted fields → evidence appears, each
  item with provider and date → appeal letter generated with the evidence cited → patient gets a
  "your appeal is ready" text.

## Open

- Product name.
- Tech stack and repo layout.
- Team split across the 4 developers.
- Evidence rule tables for the demo scenario.
- Whether official MHacks prize rules (announced at opening ceremony) change any of the above.
