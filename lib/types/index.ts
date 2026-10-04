/**
 * @file Shared types: the contract between all four workstreams.
 *
 * Covers documents, extracted fields with provenance (SPEC.md §4.2), confirmed bills and EOBs,
 * FinchNode records (`VerbatimFact`), findings with required sources (SPEC.md §4.3, §5.6), the
 * audit verdict, and drafts. Changing anything here affects everyone: say so in the commit message
 * and the task notes (SPEC.md §5.3).
 */

/** Money in integer cents. Never a float (SPEC.md §5.4). */
export type Cents = number;

/** An ISO 8601 calendar date string, e.g. "2026-09-14". */
export type IsoDate = string;

/** What kind of document an upload is. Decided before any extraction (SPEC.md §4.2 step 1). */
export type DocType =
  | "itemized_bill"
  | "balance_statement"
  | "eob"
  | "revised_statement"
  | "denial_letter"
  | "unknown";

/**
 * How a field was read from the document.
 * - `read`: the model found and read a value.
 * - `unreadable`: the value is present on the page but could not be read; shown as "[to confirm]".
 * - `absent`: the document does not contain this field.
 */
export type FieldStatus = "read" | "unreadable" | "absent";

/** Result of the deterministic checks for one field (SPEC.md §4.2 steps 5–6). */
export type Verification = "verified" | "needs_attention";

/**
 * One extracted field with provenance. The model fills `raw`, `page`, `snippet`, and `status`;
 * code fills `value` (normalized) and later `verification` and `issues`.
 *
 * @typeParam T - Normalized value type (e.g. `Cents`, `IsoDate`, `string`, `number`).
 */
export interface Field<T> {
  /** The text exactly as printed on the document, or `null` if absent. */
  raw: string | null;
  /** Normalized value (integer cents, ISO date, trimmed code), or `null`. Never guessed. */
  value: T | null;
  /** 1-based page number where the value was read, or `null`. */
  page: number | null;
  /** Short verbatim snippet around the value, used for highlighting and the text-layer check. */
  snippet: string | null;
  /** How the value was read. */
  status: FieldStatus;
  /** Set by the checks: `verified` only if every check passed. */
  verification: Verification;
  /** Human-readable reasons this field needs attention. Empty when verified. */
  issues: string[];
}

/** Which coding system a billing code belongs to. Format is checked; values are not looked up. */
export type CodeType = "CPT" | "HCPCS" | "REV" | "NDC" | "unknown";

/** Whether a bill comes from a facility, a clinician, or another entity (SPEC.md §4.2). */
export type ProviderType = "facility" | "clinician" | "other";

/** Header fields of an itemized bill or balance statement. */
export interface BillHeader {
  /** Name of the entity that issued the bill. */
  billingEntity: Field<string>;
  /** Facility, clinician, or other. */
  providerType: Field<ProviderType>;
  /** Patient account number as printed. */
  accountNumber: Field<string>;
  /** Patient name as printed. */
  patientName: Field<string>;
  /** First service date covered by the bill. */
  serviceStart: Field<IsoDate>;
  /** Last service date covered by the bill. */
  serviceEnd: Field<IsoDate>;
  /** Encounter or visit identifier, if printed. */
  encounter: Field<string>;
  /** Date the statement was issued. */
  statementDate: Field<IsoDate>;
  /** Sum of all line charges as printed. */
  totalCharges: Field<Cents>;
  /** Total insurance or contractual adjustments as printed (usually negative or shown as credit). */
  totalAdjustments: Field<Cents>;
  /** Total payments received as printed. */
  totalPayments: Field<Cents>;
  /** Amount the patient is asked to pay. */
  amountDue: Field<Cents>;
}

/** One line item on an itemized bill. */
export interface BillLine {
  /** Line number as printed (or assigned in order if none is printed). */
  lineNumber: Field<number>;
  /** Date of service for this line. */
  serviceDate: Field<IsoDate>;
  /** Billing code as printed (CPT, HCPCS, revenue code, NDC). */
  code: Field<string>;
  /** Coding system of `code`. */
  codeType: Field<CodeType>;
  /** Description as printed. */
  description: Field<string>;
  /** Units billed. */
  quantity: Field<number>;
  /** Price per unit, if printed. */
  unitPrice: Field<Cents>;
  /** Total charge for the line. */
  charge: Field<Cents>;
  /** Adjustment applied to the line, if printed. */
  adjustment: Field<Cents>;
  /** Patient responsibility for the line, if printed. */
  patientResponsibility: Field<Cents>;
}

/** An itemized bill as extracted and checked, before patient confirmation. */
export interface ExtractedBill {
  /** Always "itemized_bill", "revised_statement", or "balance_statement". */
  docType: "itemized_bill" | "revised_statement" | "balance_statement";
  /** Header fields. */
  header: BillHeader;
  /** Line items; empty for a balance statement. */
  lines: BillLine[];
  /** Whole-document problems found by the checks (e.g. totals don't reconcile). */
  documentIssues: string[];
}

/** One line of an explanation of benefits (EOB). An EOB is not a bill (SPEC.md §4.2). */
export interface EobLine {
  /** Date of service. */
  serviceDate: Field<IsoDate>;
  /** Billing code the claim line refers to. */
  code: Field<string>;
  /** Amount the provider billed. */
  billed: Field<Cents>;
  /** Amount the plan allowed. */
  allowed: Field<Cents>;
  /** Amount the plan paid. */
  planPaid: Field<Cents>;
  /** Amount the patient owes for this line. */
  patientResponsibility: Field<Cents>;
}

/** An EOB as extracted and checked, before patient confirmation. */
export interface ExtractedEob {
  docType: "eob";
  /** Insurer name as printed. */
  insurer: Field<string>;
  /** Claim number as printed. */
  claimNumber: Field<string>;
  /** Provider the claim was filed by. */
  provider: Field<string>;
  /** Total patient responsibility as printed. */
  totalPatientResponsibility: Field<Cents>;
  /** Claim lines. */
  lines: EobLine[];
  /** Whole-document problems found by the checks. */
  documentIssues: string[];
}

/** Where a confirmed value came from, kept for the evidence view (SPEC.md §4.4). */
export interface Provenance {
  /** 1-based page number, or `null`. */
  page: number | null;
  /** Verbatim snippet, or `null`. */
  snippet: string | null;
}

/** A confirmed bill line: plain values the patient has confirmed, plus provenance. */
export interface ConfirmedBillLine {
  lineNumber: number;
  serviceDate: IsoDate | null;
  code: string | null;
  codeType: CodeType;
  description: string;
  quantity: number;
  unitPriceCents: Cents | null;
  chargeCents: Cents;
  adjustmentCents: Cents | null;
  patientResponsibilityCents: Cents | null;
  /** Where the line was read on the original document. */
  provenance: Provenance;
}

/**
 * A bill the patient has confirmed field by field. Only this type is accepted by audit rules
 * (SPEC.md §5.6). Constructed only by `confirmBill` in `lib/extract/confirm.ts`.
 */
export interface ConfirmedBill {
  readonly confirmed: true;
  /** Document this bill came from. */
  documentId: string;
  billingEntity: string;
  providerType: ProviderType;
  accountNumber: string | null;
  patientName: string | null;
  serviceStart: IsoDate | null;
  serviceEnd: IsoDate | null;
  encounter: string | null;
  totalChargesCents: Cents | null;
  amountDueCents: Cents | null;
  lines: ConfirmedBillLine[];
  /** True if the patient acknowledged that the printed totals themselves don't add up. */
  totalsMismatchAcknowledged: boolean;
}

/** A confirmed EOB line. */
export interface ConfirmedEobLine {
  serviceDate: IsoDate | null;
  code: string | null;
  billedCents: Cents | null;
  allowedCents: Cents | null;
  planPaidCents: Cents | null;
  patientResponsibilityCents: Cents | null;
  provenance: Provenance;
}

/** An EOB the patient has confirmed. Constructed only by `confirmEob`. */
export interface ConfirmedEob {
  readonly confirmed: true;
  documentId: string;
  insurer: string | null;
  claimNumber: string | null;
  provider: string | null;
  totalPatientResponsibilityCents: Cents | null;
  lines: ConfirmedEobLine[];
}

/** Category of a FinchNode record we use as evidence. */
export type RecordCategory = "lab" | "medication" | "condition" | "immunization" | "other";

/**
 * A health fact copied exactly from one FinchNode record. Never constructed from LLM output;
 * created only in `lib/finchnode/` (SPEC.md §2 rule 1, §5.6).
 */
export interface VerbatimFact {
  /** FinchNode record ID, for tracing back to the source. */
  recordId: string;
  /** Record category. */
  category: RecordCategory;
  /** The record's own display text, unmodified. */
  text: string;
  /** Clinical code on the record (e.g. LOINC for labs), if any. */
  code: string | null;
  /** Coding system of `code` (e.g. "LOINC", "RxNorm"), if any. */
  codeSystem: string | null;
  /** When the provider recorded it, ISO 8601 date. */
  recordedAt: IsoDate;
  /** Source provider, e.g. "Northstar Health System". */
  provider: string;
  /** The record's own status as FinchNode gives it (e.g. "active", "final"), if any; copied verbatim. */
  status?: string | null;
}

/** A pointer to the evidence behind a finding. Every finding needs at least one (SPEC.md §5.6). */
export type Source =
  | { kind: "bill_line"; documentId: string; lineNumber: number; provenance: Provenance }
  | { kind: "eob_line"; documentId: string; index: number; provenance: Provenance }
  | { kind: "eob_total"; documentId: string; provenance: Provenance }
  | { kind: "bill_total"; documentId: string; provenance: Provenance }
  | { kind: "record"; fact: VerbatimFact }
  /** A response recorded from the billing office or insurer (free text shown verbatim, never parsed). */
  | { kind: "response"; eventId: string; from: string; receivedAt: IsoDate; note: string | null }
  /** A document attached to the case (e.g. a lab result or revised statement). */
  | { kind: "document"; documentId: string; docType: string; label: string }
  | {
      kind: "records_searched";
      /** Providers whose records were searched. */
      providers: string[];
      /** What was looked for, e.g. "lab results for CPT 85025 on 2026-09-14 (±1 day)". */
      searched: string;
      /** How many records of the category were checked. */
      recordsChecked: number;
    };

/** A non-empty list, so a finding without a source does not compile. */
export type NonEmpty<T> = [T, ...T[]];

/** Which deterministic rule produced a finding (SPEC.md §4.3). */
export type RuleId = "duplicate_charge" | "bill_exceeds_eob" | "documentation_gap" | "insurer_denied_line";

/**
 * Finding status. MVP 1 only produces `potential`; later rungs move findings to `confirmed`,
 * `withdrawn`, or `pending` (SPEC.md §3.1, §3.5). A potential issue is never called an error.
 */
export type FindingStatus = "potential" | "confirmed" | "withdrawn" | "pending";

/** One audit finding. Produced only by rules in `lib/audit/`, never by an LLM. */
export interface Finding {
  /** Stable ID within the case, e.g. "dup-80053-2026-09-14". */
  id: string;
  /** Rule that produced it. */
  rule: RuleId;
  /** Patient chose not to pursue this issue; does not change its evidence or status. */
  patientExcluded?: boolean;
  /** Current status. */
  status: FindingStatus;
  /** Short plain-language title, written by code from a template. */
  title: string;
  /** Plain-language explanation, written by code from a template. */
  explanation: string;
  /** What the patient can reasonably ask for (written by code). */
  ask: string;
  /**
   * The finding as a paragraph of the patient's letter to the billing office, in the first person
   * ("my EOB", "Please confirm..."), with every fact filled by code from a template (SPEC.md §4.5).
   */
  letterText: string;
  /** Template text explaining the latest status change (MVP 2), written by code. */
  statusNote?: string;
  /** Evidence behind the latest status change: the response event and/or document. */
  statusSources?: Source[];
  /** True once a patient-confirmed revised statement shows the correction (SPEC.md §4.6). */
  verified?: boolean;
  /** Who can fix it: the provider's billing office (default) or the insurer (SPEC.md §3.4 routing). */
  contact?: "provider" | "insurer";
  /**
   * Call stage: `claim` (initial call, default), `appeal` (the claim was denied; a secondary call
   * appeals it), `escalated` (denied again on appeal; written appeal or a human advocate next).
   */
  stage?: "claim" | "appeal" | "escalated";
  /** Amount this finding questions, in cents (0 when not monetary). */
  amountQuestionedCents: Cents;
  /** Bill line numbers this finding covers, for de-duplicating the verdict total. */
  lineNumbers: number[];
  /** Evidence behind the finding. */
  sources: NonEmpty<Source>;
}

/** The verdict block at the top of the audit screen (SPEC.md §4.4, §4.6). */
export interface Verdict {
  /** Total billed (from the confirmed bill), or `null` if not printed. */
  totalBilledCents: Cents | null;
  /** Amount questioned by potential findings, counting each bill line once. */
  questionedCents: Cents;
  /** Reduction offered by the provider. Always `null` in MVP 1. */
  offeredCents: Cents | null;
  /** Reduction confirmed in writing. Always `null` in MVP 1. */
  confirmedCents: Cents | null;
}

/** Result of running the audit on a confirmed bill (and EOB, if any). */
export interface AuditResult {
  findings: Finding[];
  verdict: Verdict;
}

/** A paragraph of a generated letter, with the sources of every fact it contains. */
export interface DraftParagraph {
  /** Final text with all placeholders filled by code. */
  text: string;
  /** True for wording supplied by the patient, rather than verified document facts. */
  patientProvided?: boolean;
  /** Sources for the facts in this paragraph (for click-to-source). */
  sources: Source[];
}

/** A finished draft (dispute letter or itemized-bill request). */
export interface Draft {
  kind: "dispute_letter" | "itemized_bill_request" | "appeal_letter" | "documentation_request";
  /** Letter subject line. */
  subject: string;
  /** Body paragraphs in order. */
  paragraphs: DraftParagraph[];
  /** Original generated paragraphs retained for reset and server-side fact protection. */
  originalParagraphs?: DraftParagraph[];
  /** Patient-added explanation, stored separately from sourced facts. */
  personalNote?: string;
  /** Whether the patient has saved personalized wording. */
  patientEdited?: boolean;
  /** Whether Gemini wrote the prose (`llm`) or the deterministic template was used (`template`). */
  author: "llm" | "template";
}

/** How the counterparty answered one finding (recorded from the operator console, MVP 2). */
export type ResponseKind = "confirms_error" | "provides_documentation" | "needs_more_info" | "will_send_later" | "refused";

/**
 * A response from the billing office or insurer, recorded as structured data (SPEC.md §3.5).
 * `note` and the free-text fields are shown verbatim and never parsed by code or a model.
 */
export interface CounterpartyResponse {
  /** Who answered, e.g. "Quillhaven Medical Group billing office". */
  from: string;
  /** One answer per finding addressed. */
  perFinding: Array<{
    findingId: string;
    kind: ResponseKind;
    /** What document is still needed (for `needs_more_info` / `will_send_later`). */
    neededDocument?: string;
    /** Who must provide it (defaults to `from`). */
    responsibleParty?: string;
    /** Date they promised it by, if any. */
    promisedBy?: IsoDate;
  }>;
  /** Attached document, if any (required for `provides_documentation`). */
  documentId?: string;
  /** Plain label of the attached document, e.g. "Lab result: free T4, collected 03/05/2026". */
  documentLabel?: string;
  /** Free text from the counterparty, shown verbatim. */
  note?: string;
}

/** A pending piece of work on a case (SPEC.md §3.6, §4.6). */
export interface CaseTask {
  id: string;
  /** `await_document`: someone else will send it; `request_document`: we must ask for it. */
  kind: "await_document" | "request_document" | "follow_up";
  /** Finding this task belongs to, if any. */
  findingId?: string;
  /** Plain description of the document or step, e.g. "revised statement". */
  documentNeeded: string;
  /** Who is responsible for the next step. */
  responsibleParty: string;
  /** Follow-up date, or `null` when unconfirmed. */
  followUpDate: IsoDate | null;
  /** `patient_handling` = the patient took this over ("I'll do this myself"). */
  status: "open" | "done" | "patient_handling";
  /** Document that fulfilled the task, once done. */
  fulfilledBy?: string;
}

/** Result of comparing a revised statement with the original bill (SPEC.md §4.6 verification). */
export interface RevisedComparison {
  /** Original lines with no counterpart on the revised statement. */
  removedLines: number[];
  /** Original lines still present but with a lower charge: [lineNumber, oldCents, newCents]. */
  reducedLines: Array<[number, Cents, Cents]>;
  /** Revised-statement lines with no counterpart on the original (new charges). */
  newLines: number[];
  /** Original amount due, if printed. */
  originalDueCents: Cents | null;
  /** Revised amount due, if printed. */
  revisedDueCents: Cents | null;
  /** Original due − revised due when positive and both are known; otherwise 0. */
  confirmedSavingsCents: Cents;
  /** Finding IDs whose questioned lines are all removed (or reduced to zero). */
  resolvedFindingIds: string[];
  /** Finding IDs (confirmed by the office) whose lines are still billed. */
  notReflectedFindingIds: string[];
}

/** Field names read from an insurance denial letter (MVP 5). */
export type DenialKey =
  | "insurer" | "memberName" | "memberId" | "referenceNumber" | "letterDate" | "deniedService" | "serviceCode"
  | "plannedDate" | "provider" | "denialReason" | "policyId" | "appealDeadline" | "appealAddress";

/** A denial letter as extracted (SPEC.md §4.10); dates are ISO, everything else text. */
export interface ExtractedDenial {
  docType: "denial_letter";
  fields: Record<DenialKey, Field<string>>;
  /** Whole-document problems (e.g. deadline before the letter date). */
  documentIssues: string[];
}

/** A denial letter the patient confirmed field by field. Only this type feeds the criteria engine. */
export interface ConfirmedDenial {
  readonly confirmed: true;
  documentId: string;
  insurer: string | null;
  memberName: string | null;
  memberId: string | null;
  referenceNumber: string | null;
  /** ISO date the letter was issued (criteria windows count back from it). */
  letterDate: IsoDate | null;
  deniedService: string | null;
  serviceCode: string | null;
  plannedDate: IsoDate | null;
  provider: string | null;
  denialReason: string | null;
  policyId: string | null;
  appealDeadline: IsoDate | null;
  appealAddress: string | null;
}
