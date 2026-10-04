# PLAN: mvp5-denial-appeal (demo scope)

Planning output (`prompts/PLAN.md`), written for a ~3-hour build before the deadline. Scope is cut
deliberately; cuts are listed at the end.

## Goal

The patient uploads an insurance denial letter. The app reads it (patient confirms every field),
checks each of the insurer's own criteria against the patient's FinchNode records **from both
providers**, and shows each criterion as **met** (with verbatim record citations), **missing**
(exactly what's needed), or **unconfirmed**. If all are met, it drafts a cited appeal letter; if any
is missing, it drafts a documentation request to the treating provider instead (no weak appeal).
SPEC.md §4.10, §6 MVP 5. This is the strongest FinchNode moment: records from Northstar and
Quillhaven feeding one appeal.

## Demo scenario (fits the real sandbox data and doesn't contradict the bill/EOB)

Wolverine Mutual Health **denies prior authorization** for Priya's **endocrinology follow-up visit
(CPT 99214) planned for 04/16/2026** at Quillhaven, as **not medically necessary** under policy
**WMH-MP-112 "Specialist care for thyroid disorders"**. Letter date 04/02/2026, reference
PA-2026-0402-1183, appeal deadline 06/01/2026. The letter prints the policy's three criteria:

| # | Insurer criterion (printed) | Rule (code) | Priya's records |
|---|---|---|---|
| 1 | A documented diagnosis of a thyroid disorder | condition, SNOMED 40930008 or text "hypothyroid", recorded on/before the letter date | Hypothyroidism at **Northstar** and **Quillhaven** (2019-05-01) → met |
| 2 | Current thyroid hormone treatment | medication, RxNorm 966221 or text "levothyroxine", status active, started on/before the letter date | Levothyroxine at **Northstar** (2026-03-02) and **Quillhaven** (2026-03-05) → met |
| 3 | A thyroid function test within 60 days before the request | lab, LOINC 3016-3 or 3024-7, dated 0–60 days before the letter date | TSH + free T4 at **Northstar** (2026-03-02), TSH at **Quillhaven** (2026-03-05) → met |

All three met → cited appeal letter. Each paragraph quotes the record text, provider, and date
verbatim from FinchNode. A unit test also covers a "missing" variant (records without a recent
lab) to prove the documentation-request path.

## Rules this must keep (SPEC.md §2, §4.10)

- The model only **transcribes** the letter; the patient confirms each field. Criteria come from the
  confirmed policy ID mapped to a **code lookup table**, never from model interpretation.
- Met/missing is decided by code from FinchNode records; evidence is `VerbatimFact`s, quoted exactly.
- The appeal letter is a deterministic template filled by code (no model prose in this cut).
- Nothing is sent; download as PDF. Labeled synthetic.

## Design

1. **Fixture:** `DENIAL` in `scripts/fixture-data.ts`; `make-fixtures.ts` writes
   `fixtures/documents/denial-letter.pdf` and `fixtures/llm-output/denial-letter.json`; add to the
   extraction eval and `SAMPLE_NAMES`.
2. **Extraction** (`lib/extract`): `RawDenialSchema` + JSON schema (fields: insurer, memberName,
   memberId, referenceNumber, letterDate, deniedService, serviceCode, plannedDate, provider,
   denialReason, policyId, appealDeadline, appealAddress); `buildDenial` (normalize with existing
   parsers, text-layer cross-check, checks: valid dates, deadline after letter date, code format);
   pipeline routes `denial_letter` to it instead of "unsupported"; `ExtractedDenial` /
   `ConfirmedDenial` types; `confirmDenial` (flagged fields must be corrected or confirmed).
3. **Criteria engine** (`lib/appeals/criteria.ts`, pure): `POLICY_LOOKUP["WMH-MP-112"]` with the
   three rules above; `evaluateDenial(denial, records) → { policyKnown, criteria: [{ id, text,
   status, evidence: VerbatimFact[], searched, needed? }], allMet }`. Unknown policy → plain
   "we can't check this policy" (handoff), never a guess.
4. **Letters** (`lib/appeals/letter.ts`): `draftAppealLetter` (one paragraph per criterion: insurer
   requires X; records show Y from provider on date, with sources) and `draftDocumentationRequest`
   (to the treating provider, listing exactly what's missing). Both return `Draft` (new kinds
   `appeal_letter`, `documentation_request`) so the existing PDF renderer and letter screen work.
5. **Service + API:** `ingestSample` handles `denial-letter`; `confirmDocument` handles denials;
   `POST /api/appeals { documentId }` → `{ evaluation, draft, providers, recordsOrigin }`.
6. **UI:** "Insurance denial letter" sample button; confirm panel for denial fields; an appeal screen:
   criteria cards (met/missing chips, record citations with provider and date), then the letter
   (reuse `LetterScreen`).

## Steps (in order)

1. Fixture + types + schemas + `buildDenial` + pipeline + `confirmDenial`; tests; eval on Grok.
2. Criteria engine + tests (met with both providers; missing variant; unknown policy).
3. Letters + tests (every fact present, sources attached, no model).
4. Service + route + UI; browser check; deploy.
5. Notes: `IMPLEMENTATION.md`, SPEC.md §6 status, HANDOFF.md.

## Cut for time (say so in the pitch if asked)

Step-therapy denials; adding appeals to the adaptive case (approvals, waiting, tracking); model-written
appeal prose; insurer calls; other policies in the lookup.

## Verification

Unit tests for extraction checks, criteria, and letters; live eval of the denial letter on Grok;
browser run on the deployed app: sample denial → confirm → 3 criteria met with Northstar and
Quillhaven citations → appeal letter → PDF.
