# Project spec — Record Watch (working name)

MHacks 2026, Oct 3–4, Ann Arbor. 4 developers, ~24 hours. Primary target: the FinchNode prize.
Secondary: 2nd/3rd-place sponsor prizes from supporting integrations.

Status: **working draft** from the team's ideation. Items marked *Open* are not decided — do not
treat them as requirements. Update this file when the team decides something.

## Product

"Credit monitoring for your medical records." A user links their health records from every
provider through FinchNode. The app keeps them synced, detects when anything changes or when
providers disagree, and asks the user to confirm. If the user says something is wrong, an agent
handles the correction paperwork and follow-up.

It also keeps an always-current emergency page that the user links from their iPhone Medical ID.

## Core invariant: AI handles logistics, never medicine

This is the project's central design rule and the main thing the audit and test phases must
enforce.

- **Health facts flow deterministically** from FinchNode to every output (screens, texts, voice,
  emergency page, correction letters). They are copied verbatim with their source attached
  (provider + date). An LLM never writes, summarizes, paraphrases, or interprets a health fact.
- **Change and conflict detection is deterministic** (record diffing / comparison), not LLM
  judgment.
- **The user is the only judge of what is true.** The app asks; it never asserts a record is
  wrong.
- **The AI may decide only logistics**: classifying a change type, who to contact, drafting
  non-clinical paperwork around verbatim facts, when to follow up, scheduling.
- No medical advice, diagnosis, or treatment suggestions anywhere.

## Features

1. **Connect records** — FinchNode hosted Connect flow (patient finds provider, authenticates
   with that provider directly, consents).
2. **Record sync + snapshots** — scheduled sync and/or FinchNode signed webhooks; store every
   version so changes are diffable over time.
3. **Change and conflict detection** — new/removed/modified entries; disagreements between
   providers (e.g. a medication active at one provider and discontinued at another).
4. **Confirm via text** — "Northstar added a penicillin allergy to your record on 10/2. Is this
   right? Reply YES or NO."
5. **Correction agent** — on NO: draft a HIPAA right-to-amend request (verbatim record + source),
   address it to the right provider's records department, track the 60-day response window, and
   follow up.
6. **Emergency page** — short link (e.g. `ln.app/x7k2`) showing only emergency basics (allergies,
   current medications, conditions, emergency contact), each with source. Revocable. Every view is
   logged and texted to the user.
7. **Medical ID setup** — apps cannot read or write the iPhone Medical ID. The app gives the user
   paste-ready text: stable items (blood type, emergency contacts, severe allergies, major chronic
   conditions) plus the emergency page link in the Medical Notes field. The app prompts a Medical
   ID edit only when a stable item changes; routine changes update the linked page silently.

Optional / stretch: QR on lock screen via widget, Live Activity, Focus-linked lock screen, or
wallpaper (all point at the same emergency link). Lock screen widgets render in a translucent
tint, so QR scannability must be tested on a real device before committing to it.

## FinchNode (verified from finchnode.com, 2026-10-02)

- Read-only, patient-authorized US health records across 17 EHR/payer families (Epic, Oracle
  Health, athenahealth, eClinicalWorks, MEDITECH, Veradigm, Medicare, ...).
- Normalized API: `/users/{subject}/records` (current); `/patients` routes are legacy.
- Data categories: demographics, medications, conditions, allergies, vital signs, labs,
  immunizations, source-specific coverage and claims.
- Free plan: synthetic sandbox (12 named scenarios from two synthetic sources, **Northstar Health
  System** and **Quillhaven Medical Group**, no auth needed), hosted consent, scheduled sync,
  signed webhooks.
- The FinchNode MCP connector was reported unhealthy on 2026-10-02; do not depend on it.
- *Open:* exact response schema, webhook payloads, and whether the sandbox can simulate record
  changes over time. Verify against the docs and the FinchNode workshop (Sat 2–3 PM, VR Lab).

## Supporting sponsors

| Sponsor | Role |
|---|---|
| Photon (Spectrum SDK) | iMessage/WhatsApp texts and YES/NO replies |
| Neon | Serverless Postgres: users, record snapshots, diffs, alerts, view log |
| ElevenLabs | Voice (stretch: call a records office, spoken weekly update) |
| Fetch.ai | Agentverse agents (watch / correct / follow up) reachable from ASI:One |

Skipped: SpacetimeDB, Freesolo, Relay, Capital One, FREE-WiLi, Meta, Supabase.

## Demo constraints

- Must work fully on the FinchNode synthetic sandbox; no real patient data.
- Keep a local mock of the sandbox data so the demo survives API or network issues.

## Open

- Product name (Record Watch is a working name).
- Tech stack and repo layout.
- Team split across the 4 developers.
- Whether official MHacks prize rules (announced at opening ceremony) change any of the above.
