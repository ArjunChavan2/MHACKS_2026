# Project spec — Medical Passport (working name)

MHacks 2026, Oct 3–4, Ann Arbor. 4 developers, ~24 hours. Primary target: the FinchNode prize.
Secondary: 2nd/3rd-place sponsor prizes from supporting integrations.

Status: **working draft**. Items marked *Open* are not decided — do not treat them as
requirements. Update this file when the team decides something.

## Product

A medical passport on your phone. FinchNode aggregates your health records from every provider.
The app builds an emergency profile from them and puts it behind a QR code on your lock screen
wallpaper. If you end up in an ER unidentifiable or unable to communicate, a clinician scans the
QR code and immediately sees what they need — allergies, medications, conditions, recent
procedures — instead of digging through your whole history. The clinician can describe the
emergency, and the passport puts the records most relevant to it first.

Hackathon scope (phone version): **FinchNode → passport → emergency QR → clinician view.**

## Core invariant: AI never writes or hides a health fact

This is the project's central design rule and the main thing the audit and test phases must
enforce.

- **Health facts are verbatim.** Every health fact shown anywhere (passport, clinician view,
  texts) is copied exactly from a FinchNode record with its source attached (provider + date).
  An LLM never writes, summarizes, paraphrases, or interprets a health fact.
- **The passport is built by deterministic rules**, not an LLM: which categories are included,
  what counts as recent, deduplication, and conflict detection.
- **Conflicts are shown, never resolved.** When providers disagree, both versions are displayed
  side by side with their sources.
- **The emergency-specific view only reorders.** The AI may rank and highlight existing records
  for a described emergency. It cannot add, remove, rewrite, or hide anything; "show everything"
  is always one tap away, and anything not ranked still appears.
- **The clinician makes all medical decisions.** No diagnosis, treatment suggestions, or advice.

## Features

1. **Connect records** — FinchNode hosted Connect flow (patient finds provider, authenticates
   with that provider directly, consents).
2. **Build the passport** (deterministic) — from FinchNode records:
   - allergies (all)
   - active medications
   - conditions
   - procedures and encounters from the last *N* months (*Open:* value of *N*)
   - demographics needed for identification (name, date of birth, photo if available)
   - emergency contact (entered by the patient)

   Deduplicate the same item reported by several providers (keeping every source). Detect
   cross-provider conflicts, e.g. a medication active at one provider and discontinued at
   another.
3. **Patient passport view** — the patient reviews their passport, sees conflicts, and can add an
   emergency contact. The patient cannot edit health facts (they come from records).
4. **Emergency QR** — a revocable short link (e.g. `ln.app/x7k2`) encoded as a QR code. The app
   generates a lock screen wallpaper with the QR in the bottom-center area (clear of the clock,
   notifications, and the flashlight/camera buttons) labeled e.g. "EMERGENCY MEDICAL INFO — SCAN".
   The link points to live data, so the wallpaper never needs replacing when records change.
5. **Clinician view** — mobile web page opened by scanning. Minimal and extremely readable:
   critical items (allergies, conflicts) first, every item with its source. Shows only the
   passport, never the full record history.
6. **Emergency-specific ranking** — the clinician enters the situation ("chest pain",
   "unconscious, possible overdose"). An LLM returns an ordering of existing passport item IDs
   (and optional highlight flags); the page re-renders the same verbatim items in that order. The
   LLM's output is validated in code: unknown IDs are discarded and any items it omitted are
   appended, so nothing can be added or lost.
7. **Access logging and alerts** — every clinician view is logged (time, approximate location if
   available) and the patient is texted immediately ("Your medical passport was opened at
   3:12 PM"). The patient can revoke the link, which issues a new one.
8. **Medical ID setup** — apps cannot read or write the iPhone Medical ID. The app gives the
   patient paste-ready Medical ID text: stable items (blood type, emergency contact, severe
   allergies, major chronic conditions) plus the passport link in the Medical Notes field, since
   responders are trained to check Medical ID.

### Access control

Real verification that a viewer is hospital staff is out of scope for 24 hours. Hackathon model:
**emergency override access** — anyone with the link sees the passport, every view is logged, and
the patient is alerted in real time. Clinician verification is presented as future work.

### Optional / stretch

- QR in a lock screen widget, Live Activity, or Focus-linked lock screen instead of the wallpaper.
  Lock screen widgets render in a translucent tint, so QR scannability must be tested on a real
  device first. These need a native Swift app.
- Voice: a clinician asks the passport questions aloud (answers must still be verbatim records,
  e.g. read out the matching items).

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
- *Open:* exact response schema, whether procedures/encounters are exposed (not in the listed
  categories), and which sandbox scenario shows a good cross-provider conflict. Verify against the
  docs and the FinchNode workshop (Sat 2–3 PM, VR Lab).

## Supporting sponsors

| Sponsor | Role |
|---|---|
| Photon (Spectrum SDK) | iMessage/WhatsApp alert to the patient when the passport is opened |
| Neon | Serverless Postgres: users, passports, share links, access log |
| ElevenLabs | Stretch: voice for the clinician view |
| Fetch.ai | Stretch: passport agent on Agentverse reachable from ASI:One (e.g. "create my emergency passport") |

Skipped: SpacetimeDB, Freesolo, Relay, Capital One, FREE-WiLi, Meta, Supabase.

## Demo

- Runs fully on the FinchNode synthetic sandbox; no real patient data.
- Keep a local mock of the sandbox data so the demo survives API or network issues.
- Flow: connect records → passport with a conflict flagged → wallpaper with QR → a second phone
  scans it → clinician view → clinician enters "chest pain" and the relevant items move to the
  top → patient phone gets the "passport opened" text.
- Lead with the conflict flag and the emergency-specific ranking; emergency-passport apps have won
  at other 2026 hackathons, so these are the differentiators.

## Open

- Product name.
- Tech stack and repo layout.
- Team split across the 4 developers.
- Value of *N* for "recent" procedures/encounters.
- Whether official MHacks prize rules (announced at opening ceremony) change any of the above.
