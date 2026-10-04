# MHacks 2026 Demo Plan

Source: https://docs.google.com/document/d/1S4FueYPu7byvy9Q3Qk__S0C31WRCCDMtkgiwihTp9xQ/edit

Demo Flow
AI medical-bill auditor / patient advocate

1. Upload your itemized medical bill
2. Use Grok Files API for document pdf parser?
3. The app goes through deterministic bill-auditing to find questionable charges, duplicate billing, coding mismatches, out-of-network surprises, or charges that appear inconsistent with the insurer’s explanation
4. App uses AI to generate either a patient-friendly email draft/script OR use the script to advocate for you on the phone using Eleven Labs
5. As AI disputes for you, use Photon to send you text updates + “select A or B for this action”

https://www.cms.gov/initiatives/your-patient-rights/medical-bill-rights/get-help/dispute-bill
Product
The patient uploads a medical bill or an insurance denial letter. The app finds what's wrong, then fights it for them: it drafts the dispute or appeal, can make the phone call, and keeps the patient updated by text. The patient can steer the call while it happens.

- Bill audit (base product): upload an itemized bill and fixed rules flag duplicates, coding mismatches, out-of-network surprises, charges that don't match the insurer's explanation of benefits, and lab or medication charges with no matching medical record.
- Denial appeals (our differentiator): upload a denial letter and the app pulls evidence from the patient's records at every provider, then drafts an appeal that cites each record.
  Pitch: "Appealing is free. Winning takes evidence. We bring the evidence. We win."

Why FinchNode is essential
FinchNode's judges asked what we are doing with the data. Our answer: we use medical records as evidence against a bill or an insurer, not just to view them.

- Appeals: an appeal is won with medical evidence, and that evidence is spread across every provider the patient has seen. Without FinchNode there is no evidence and no appeal.
- Bill audit: records let us ask whether a charged lab or medication actually happened.
  Core rule: AI never writes a health fact or invents a finding
- Every health fact in a letter, script, call or screen is copied exactly from a FinchNode record, with the provider and date.
- Audit flags and appeal evidence come from fixed rules in code, never from the AI. Each one cites its bill line, EOB line or record.
- A charge with no matching record becomes a documentation request ("please provide documentation for this charge"), never "you were overcharged".
- The AI only does paperwork and conversation: reading documents (the patient confirms every field), drafting prose around the findings, and speaking on calls.
- Nothing is sent, submitted or agreed to without the patient's approval. No medical advice anywhere.
  Bill audit
- Upload an itemized bill and, if available, the EOB (explanation of benefits). Grok reads them and the patient confirms the fields.
- - Rules: duplicate charges; coding mismatches (scope to be decided); out-of-network charges where the No Surprises Act may apply; billed amount above what the EOB says the patient owes; lab or medication charges with no matching record.
- Output: a dispute email with each finding cited, plus suggestions where relevant (financial assistance, payment plan). Reference: CMS medical bill rights page above.
  Denial appeals
- Upload the denial letter. Grok reads it and the patient confirms the denial reason, deadline and where to send the appeal.
- Step therapy ("try cheaper drugs first"): find the required drugs that were prescribed and stopped, at any provider.
- Not medically necessary: find documented conditions and lab results that justify the service, using a small lookup table.
- Unsupported denial type or no evidence found: the app says so and does not draft a weak appeal.
- The AI writes the letter with blanks; code fills in each record exactly, with its source. The patient reviews and downloads a PDF.
  Phone calls and live decisions
- An ElevenLabs voice agent calls the billing office or insurer using a script built from the same findings.
- The patient watches a live call screen with the status, a running transcript and decision prompts.
- When the rep says something that needs a decision (for example, "20% off if you pay today, or a payment plan"), the agent says "one moment while I check with the patient" and the patient gets 2 to 4 buttons, such as "Accept 20%", "Ask for 40%", "Payment plan" or "Get it in writing". A short custom instruction also works.
- If the patient isn't on the call screen, the same choice arrives as a Photon text: "Reply A, B or C."
- If no answer arrives in time, the agent agrees to nothing and asks for the offer in writing or a callback. The agent can never commit to a payment, settlement or sharing information the patient didn't choose.
  Demo flow

1. Hook (15 seconds): a surprise bill and a denied prescription, and most people never push back.
2. Connect records: FinchNode Connect on the sandbox, with records arriving live from both Northstar and Quillhaven.
3. Upload the bill: photograph the itemized bill and confirm the fields the app read.
4. Audit findings: a duplicate charge (two bill lines) and a lab charge with no matching result in any record, phrased as a documentation request. A running total shows the dollars in dispute.
5. Two-way iMessage (Photon): the advocate texts "Found 2 issues worth $X. A: email the billing office, B: call them." The patient asks "why is the lab charge flagged?" and gets an answer citing the bill line and the records searched, then replies B.
6. Live call (ElevenLabs): the voice agent calls a teammate playing the billing office, with the transcript on the live call screen.
7. Patient steers the call: the rep offers 20% off for paying today, options pop up, the patient taps "Ask for 40%" and the agent counters. The rep agrees to remove the duplicate and review the lab charge, and the agent asks for it in writing.
8. Savings: the case screen updates the total saved (our FinTech angle).
9. Denial appeal (the differentiator): upload the step therapy denial letter. Evidence appears from both providers with provider and date, the appeal letter cites every record, and an iMessage says "Your appeal is ready."
10. Close (15 seconds): "Appealing is free. Winning takes evidence. We bring the evidence." The AI never invents a fact; every claim traces to a bill line or a record.
    Setup: fixtures matched to one sandbox patient with records at both providers (a bill with a planted duplicate and an unmatched lab charge, an EOB, and a step therapy denial letter). Keep the saved-data switch ready in case the network fails.
    Backups: a screen recording of a good run and a pre-recorded call in case the live call fails.
    Stack

- App: Next.js (TypeScript), Tailwind and shadcn/ui, hosted on Vercel.
- Database: Neon Postgres with Drizzle ORM.
- Records: FinchNode API, called only from the server, with a switch to saved sandbox data for the demo.
- AI: Grok for reading documents (Files API) and drafting letters and scripts.
- Rules: plain TypeScript functions for the audit and the appeal evidence, with tests.
- Voice: ElevenLabs Conversational AI and Twilio for outbound calls, with an ask_patient tool that waits for the patient's choice.
- Texts and live call screen: a small Node worker running Photon's Spectrum SDK and pushing call updates to the browser.
- Stretch: a Fetch.ai agent reachable from ASI:One.
- Login: none for the demo, one demo user.
  Team split (proposed)
  Dev 1: FinchNode and evidence
- FinchNode client, saved sandbox data and the demo fixtures (bill, EOB, denial letter matched to one sandbox patient).
- Appeal evidence rules and the bill-vs-records check.
  Dev 2: Frontend
- Upload and confirm screens, findings view, letter review, case list.
- Live call screen with transcript and decision buttons.
  Dev 3: Documents and drafting
- Grok document reading and the confirm-fields flow.
- Bill audit rules, letter and email drafting with exact record insertion, PDF.
  Dev 4: Voice, texts and database
- ElevenLabs agent, Twilio calling and the ask_patient tool.
- Photon worker for texts and A/B replies, live call updates, Neon schema.
  Check these first
- Whether an ElevenLabs tool call can wait 20 to 60 seconds for the patient. If not, the agent needs a "still checking" loop.
- Whether Grok's Files API reads scanned bills and photos, not just text PDFs.
- Whether FinchNode medication records include stopped status and dates, and which sandbox patient fits a step therapy denial.
- Call consent: billing offices verify identity and may require the patient's authorization. For the demo a teammate plays the office; have an answer ready for judges.
  Open questions
- Product name.
- Which coding-mismatch rules are realistic in 24 hours.
- Who takes which role.
- Whether the prize rules announced at the opening ceremony change anything.
