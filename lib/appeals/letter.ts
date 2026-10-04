/**
 * @file Appeal letter and documentation request for a denial (SPEC.md §4.10, MVP 5).
 *
 * Deterministic templates filled by code: every fact comes from the confirmed denial letter or is a
 * FinchNode record quoted verbatim with its provider and date, and each paragraph carries the
 * records it cites as sources. No model writes any part of these letters in this version.
 */
import { DISCLAIMER } from "@/lib/draft/letters";
import { longDate } from "@/lib/format";
import type {
  ConfirmedDenial,
  Draft,
  DraftParagraph,
  Source,
  VerbatimFact,
} from "@/lib/types";
import type { DenialEvaluation } from "./criteria";

/**
 * Quotes one record for a letter: its own text, provider, and date.
 *
 * @param r - Verbatim record.
 * @returns e.g. `"Hypothyroidism", recorded by Northstar Health System (Synthetic) on May 1, 2019`.
 */
function quote(r: VerbatimFact): string {
  return `"${r.text}", recorded by ${r.provider} on ${longDate(r.recordedAt)}`;
}

/** A `record` source for a fact. */
function source(r: VerbatimFact): Source {
  return { kind: "record", fact: r };
}

/**
 * Points notice-derived correspondence facts to the patient-confirmed original document.
 * @param denial - Confirmed notice whose fields supply the recipient, service and deadline.
 * @returns A document citation; it neither interprets the notice nor invents a policy source.
 */
function denialSource(denial: ConfirmedDenial): Source {
  return {
    kind: "document",
    documentId: denial.documentId,
    docType: "denial_letter",
    label: `Patient-confirmed denial notice · reference ${denial.referenceNumber ?? "not recorded"}`,
  };
}

/**
 * Drafts the appeal when every criterion is met.
 *
 * @param denial - Confirmed denial letter.
 * @param evaluation - Result of `evaluateDenial` (must have `allMet`).
 * @returns The appeal letter (`kind: "appeal_letter"`, `author: "template"`).
 * @throws {Error} When not every criterion is met (use `draftDocumentationRequest`).
 */
export function draftAppealLetter(
  denial: ConfirmedDenial,
  evaluation: DenialEvaluation,
): Draft {
  if (!evaluation.allMet || !evaluation.policy)
    throw new Error("An appeal is drafted only when every criterion is met.");
  const d = denial;
  const p = (text: string, sources: Source[] = []): DraftParagraph => ({
    text,
    sources,
  });
  const date = (x: string | null) =>
    x ? longDate(x) : "the date shown on your letter";
  const paragraphs: DraftParagraph[] = [
    p(`To ${d.insurer ?? "the insurer"} Appeals:`, [denialSource(d)]),
    p(
      `I am appealing the denial of prior authorization for ${d.deniedService ?? "the requested service"}${d.serviceCode ? ` (CPT ${d.serviceCode})` : ""} planned for ${date(d.plannedDate)} with ${d.provider ?? "my provider"}, reference ${d.referenceNumber ?? "(not shown)"}, member ID ${d.memberId ?? "(not shown)"}. Your letter dated ${date(d.letterDate)} denied it as "${d.denialReason ?? "not covered"}" under policy ${evaluation.policy.id} (${evaluation.policy.title}). My medical records from ${evaluation.providers.join(" and ")} show that each of the policy's criteria is met:`,
      [denialSource(d)],
    ),
    ...evaluation.criteria.map((c, i) =>
      p(
        `${i + 1}. ${c.text}. My records show ${c.evidence.map(quote).join("; and ")}.`,
        c.evidence.map(source),
      ),
    ),
    p(
      `Because every criterion of policy ${evaluation.policy.id} is documented, I ask you to reverse this denial and approve the visit. I can provide copies of these records on request. Your notice lists an appeal deadline of ${date(d.appealDeadline)}. Please confirm the available review process and whether any deadline extension applies.`,
      [denialSource(d)],
    ),
    p(`Sincerely,\n${d.memberName ?? ""}`.trim(), [denialSource(d)]),
    p(DISCLAIMER),
  ];
  return {
    kind: "appeal_letter",
    subject:
      `Appeal of prior authorization denial ${d.referenceNumber ?? ""}`.trim(),
    paragraphs,
    author: "template",
  };
}

/**
 * Drafts a documentation request to the treating provider when criteria are missing or unconfirmed,
 * instead of a weak appeal (SPEC.md §4.10).
 *
 * @param denial - Confirmed denial letter.
 * @param evaluation - Result of `evaluateDenial` with at least one criterion not met.
 * @returns The request (`kind: "documentation_request"`, `author: "template"`).
 */
export function draftDocumentationRequest(
  denial: ConfirmedDenial,
  evaluation: DenialEvaluation,
): Draft {
  const d = denial;
  const open = evaluation.criteria.filter((c) => c.status !== "met");
  const met = evaluation.criteria.filter((c) => c.status === "met");
  const paragraphs: DraftParagraph[] = [
    { text: `To my care team at ${d.provider ?? "your office"}:`, sources: [] },
    {
      text: `${d.insurer ?? "My insurer"} denied prior authorization for ${d.deniedService ?? "my visit"} (reference ${d.referenceNumber ?? "not shown"}) under policy ${d.policyId ?? "(not shown)"}. To appeal before ${d.appealDeadline ? longDate(d.appealDeadline) : "the deadline"}, I need documentation for these criteria, which my records don't show yet:`,
      sources: [denialSource(d)],
    },
    ...open.map((c, i) => ({
      text: `${i + 1}. ${c.text}: please send ${c.needed ?? "documentation"}.`,
      sources: c.evidence.map(source),
    })),
    ...(met.length
      ? [
          {
            text: `My records already document: ${met.map((c) => c.text.toLowerCase()).join("; ")}.`,
            sources: met.flatMap((c) => c.evidence.map(source)),
          },
        ]
      : []),
    { text: `Thank you,\n${d.memberName ?? ""}`.trim(), sources: [] },
    { text: DISCLAIMER, sources: [] },
  ];
  return {
    kind: "documentation_request",
    subject:
      `Documentation needed for my appeal ${d.referenceNumber ?? ""}`.trim(),
    paragraphs,
    author: "template",
  };
}
