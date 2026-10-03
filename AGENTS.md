# AGENTS.md — how code is developed in this repo

Instructions for every coding agent (Claude Code, Cursor, Codex, ...) and every human on the team.
Read this together with `spec/PROJECT.md` (what we are building) and `CLAUDE.md` (workflow and
known bugs). When this file and a prompt in `prompts/` disagree, this file wins on code style; the
spec wins on behavior.

## 1. Non-negotiable rules

1. **AI never writes a health fact or invents a finding.** Health facts are copied verbatim from
   FinchNode records with their source. Findings (bill-audit flags, appeal evidence) come from
   deterministic code and cite a bill line, EOB line, or record. LLM output is prose and structure
   only. See section 5 for how this is enforced in code.
2. **Every function, class, type, constant, module, and test gets a detailed docstring.** No
   exceptions for "obvious" or private code. See section 4.
3. **Nothing is sent, submitted, or agreed to without the patient's explicit approval.**
4. **No secrets in git.** Keys live in `.env` (gitignored); document every variable in
   `.env.example` with a comment.
5. **No real patient data.** Use the FinchNode synthetic sandbox or the fixtures in `fixtures/`.
6. **Never add Claude or any AI as an author or co-author on commits.**

## 2. Stack and layout

TypeScript everywhere except the optional Fetch.ai agent (Python). See `spec/PROJECT.md` for the
full stack table.

```
app/                 Next.js pages + API routes (thin: validate input, call lib/, return)
lib/finchnode/       FinchNode client + USE_MOCK switch
lib/extract/         document parsing (LLM) + confirmation flow
lib/audit/           bill-audit rules + lookup tables (pure functions)
lib/evidence/        denial-appeal evidence rules + lookup tables (pure functions)
lib/draft/           letter/email/script drafting, verbatim insertion, PDF
lib/cases/           pipeline stages, handoff rules, paperwork tracker, deadlines
lib/llm/             the only place that talks to an LLM provider
lib/types/           shared types (the contract between workstreams)
db/                  Drizzle schema + queries
fixtures/            sandbox snapshots, sample bill, EOB, denial letter
workers/photon/      Photon Spectrum worker (texts, A/B replies, live call updates)
voice/               ElevenLabs agent config + Twilio glue
agents/fetch/        Python uAgent (stretch)
tests/               Vitest tests mirroring lib/ paths
```

- **Pure logic lives in `lib/`.** API routes, workers, and UI components call it; they do not
  contain business rules.
- **Only `lib/llm/` imports an LLM SDK** (the Google Gemini SDK). Everything else calls its
  functions, so the provider could change without touching anything else.
- **Only `lib/finchnode/` talks to FinchNode.** It returns our own types from `lib/types/`, never
  raw API responses.
- **Shared types change by agreement.** Editing `lib/types/` affects all four workstreams: say so
  in the commit message and in your task's `agent-notes/<task>/IMPLEMENTATION.md`.

## 3. TypeScript conventions

- `strict: true`. No `any`; use `unknown` and narrow it. No `// @ts-ignore` without a comment
  explaining why.
- Validate every external input with **zod** at the boundary: API request bodies, FinchNode
  responses, LLM output, webhook payloads, A/B replies. Inside `lib/`, trust the types.
- Prefer small pure functions that take data and return data. Side effects (DB, network, SMS,
  calls) happen at the edges and are passed in or isolated in one module.
- Name things for what they mean in the domain: `findDuplicateCharges`, `StepTherapyEvidence`,
  not `process`, `data`, `helper`.
- Errors: throw typed errors (`class FinchNodeUnavailableError extends Error`) or return a result
  union (`{ ok: true, value } | { ok: false, reason }`). Never swallow an error; never let a
  failure produce output that looks complete (an appeal with missing evidence, an audit with
  skipped rules).
- Money is integer cents (`amountCents: number`), never floats. Dates are ISO 8601 strings at
  boundaries and `Date` only inside a function.
- Formatting: Prettier defaults; lint with ESLint (Next.js config). Run both before committing.

## 4. Docstrings (required on everything)

Use **TSDoc** (`/** ... */`) in TypeScript and **Google-style docstrings** in Python. A docstring
must let a teammate (or a fresh agent session) use and change the code without reading its body.

### Every file starts with a module docstring

```ts
/**
 * @file Bill-audit rule: duplicate charges.
 *
 * Flags line items on an itemized bill that share the same billing code, service date, and
 * amount. Pure and deterministic: the same bill always yields the same findings. Part of the
 * bill-audit mode described in spec/PROJECT.md ("Bill audit" > "Audit rules").
 */
```

### Every function (exported or not) documents

- **What it does and why it exists**, in one or two sentences, in domain terms.
- **`@param`** for every parameter: meaning, units, and accepted range or shape.
- **`@returns`**: what comes back, including what an empty result means.
- **`@throws`** for every error it can throw, and when.
- **Invariants and guarantees** it keeps (e.g. "never adds or removes items", "deterministic").
- **Side effects** (DB writes, network calls, SMS) or an explicit "Pure: no side effects."
- **`@example`** for anything non-trivial.
- **Spec link** when it implements a spec rule.

```ts
/**
 * Finds duplicate charges on an itemized bill.
 *
 * Two line items are duplicates when their billing code, service date, and amount all match.
 * Quantity differences are not duplicates (a quantity of 2 is one line, not two). Each finding
 * cites both line numbers so the dispute letter can quote them.
 *
 * Pure: no side effects. Deterministic: output order follows the bill's line order.
 * Implements spec/PROJECT.md "Bill audit" > "duplicate charges".
 *
 * @param bill - A patient-confirmed itemized bill. Lines must already be validated by
 *   `BillSchema`; amounts are integer cents.
 * @returns One finding per duplicate group, each citing every line in the group. Empty array
 *   when there are no duplicates.
 * @example
 * findDuplicateCharges(sampleBill)
 * // => [{ rule: "duplicate", lines: [4, 7], code: "80053", amountCents: 14200 }]
 */
export function findDuplicateCharges(bill: ConfirmedBill): DuplicateFinding[] { ... }
```

### Every type, interface, and field documents its meaning

```ts
/** A health fact copied exactly from one FinchNode record. Never constructed from LLM output. */
export interface VerbatimFact {
  /** The record's own text, unmodified (no trimming, rewording, or case changes). */
  text: string;
  /** The provider the record came from, e.g. "Northstar Health System". */
  provider: string;
  /** When the provider recorded it, ISO 8601. */
  recordedAt: string;
  /** FinchNode record ID, so the fact can be traced back to its source. */
  recordId: string;
}
```

### Constants and lookup tables document their source

```ts
/**
 * Drugs an insurer's step therapy policy may require before approving the denied drug.
 * Covers only the demo scenario (see fixtures/denial-step-therapy.pdf); not a clinical
 * reference. Keyed by the denied drug's normalized name.
 */
export const STEP_THERAPY_REQUIREMENTS: Record<string, string[]> = { ... };
```

### React components document props and behavior

State what the component shows, what each prop means, and what user actions it triggers.

### Tests document the requirement they prove

```ts
/**
 * Proves the step therapy rule does not treat "prescribed, then discontinued" as a completed trial:
 * without documented dates or duration and an outcome, the criterion is "missing", not "met"
 * (spec/PROJECT.md, Denial appeals, "Match criteria to evidence").
 */
it("marks an undocumented trial as missing", () => { ... });
```

### Python (Fetch.ai agent)

```python
def handle_appeal_request(ctx: Context, sender: str, msg: AppealRequest) -> None:
    """Starts a denial appeal for the user and replies with the case link.

    Calls the app's /api/cases endpoint; the app does all evidence gathering and drafting.

    Args:
        ctx: uAgents context, used for logging and sending the reply.
        sender: Agentverse address of the requesting user or agent.
        msg: The request, containing the uploaded denial letter URL.

    Raises:
        AppApiError: If the app API is unreachable or rejects the request.
    """
```

### Keep docstrings true

Update the docstring in the same change as the code. A wrong docstring is a bug; the audit phase
treats it as one.

## 5. How the core rule is enforced in code

- **Health facts have their own type.** Use `VerbatimFact` (section 4) for anything that came from
  a record. Only `lib/finchnode/` creates them.
- **LLM drafts use placeholders, code fills them.** The LLM writes text like
  `{{evidence:rec_123}}`; `lib/draft/` replaces each placeholder with the matching `VerbatimFact`
  and its source. After filling, reject the draft if it contains an unknown placeholder or any
  placeholder is left unfilled.
- **LLM output is validated, never trusted.** Parse it with a zod schema. On failure, retry once,
  then fail visibly; never show partial output as if it were complete.
- **Findings carry citations.** Every finding type has a required `source` field (bill line, EOB
  line, or `recordId`). A finding without one does not compile.
- **Extraction is confirmed.** Fields extracted from uploaded documents are `Unconfirmed<T>` until
  the patient confirms them; rules and drafting only accept the confirmed type.
- **Every stage has a handoff.** Pipeline actions go through an approval gate in `lib/cases/`;
  no code path calls, sends, or submits without a recorded approval. Escalation conditions are
  explicit, tested functions, not LLM judgment.
- **Every document is tracked.** Anything requested, received, drafted, or sent creates or updates
  a `documents` row and a `case_events` entry in the same transaction.
- **Voice and text agents only say approved things.** Call scripts and mid-call options are built
  from findings; any commitment (payment, settlement, sharing information) requires a recorded
  patient choice, and a timeout means "no".

## 6. Testing

- **Vitest.** Every rule in `lib/audit/` and `lib/evidence/` has tests covering a positive case,
  a negative case, and at least one edge case. Tests live in `tests/` mirroring the `lib/` path.
- Test against `fixtures/`, not the live API. A separate smoke script checks the live FinchNode
  sandbox.
- Mock `lib/llm/` in unit tests. Include tests where the mocked LLM returns malformed output,
  unknown placeholders, or extra health claims, and assert they are rejected.
- `npm test` must pass before you push.

## 7. Git workflow

- Pull before you start; commit small, focused changes; push often (four people share `main`).
- Branch per task if your change touches shared code (`lib/types/`, `db/`), and open a PR so the
  owner of that area sees it.
- Commit messages: imperative, specific ("Add duplicate-charge audit rule"), mention shared-type
  changes.
- Never force-push `main`. Never commit `.env`, real data, or generated build output.

## 8. Definition of done

A change is done when:

- it does what its task's plan says, and nothing unrelated;
- every new or changed function, type, constant, module, and test has an accurate, detailed
  docstring;
- external inputs are validated with zod;
- tests pass and new rules have tests;
- lint and type checks pass;
- `agent-notes/<task>/IMPLEMENTATION.md` is updated (for workflow tasks).
