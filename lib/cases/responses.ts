/**
 * @file How findings change over a case (SPEC.md §3.5, §3.6, §4.6). Pure; never uses an LLM.
 *
 * Findings change status only here, in reaction to (a) a recorded counterparty response, or (b) a
 * patient-confirmed revised statement. Patient exclusions are separate preferences and survive re-audits. Every change gets a template `statusNote` written by code and
 * `statusSources` citing the response or document. Free text from the counterparty is copied into
 * the source verbatim and never interpreted.
 */
import { computeVerdict } from "@/lib/audit";
import { longDate } from "@/lib/format";
import type {
  CaseTask,
  ConfirmedBill,
  CounterpartyResponse,
  Finding,
  IsoDate,
  RevisedComparison,
  Source,
} from "@/lib/types";

/** Thrown when a response or verification can't be applied; nothing is changed. */
export class CaseRuleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CaseRuleError";
  }
}

/** Plain name of the revised-statement document, used for tasks. */
export const REVISED_STATEMENT = "revised statement";

/**
 * Merges a fresh audit run into the case's existing findings, so rerunning the rules never erases
 * a status set by a response or verification.
 *
 * - IDs present in both: the fresh rule text is used; status, note, sources, and `verified` are kept.
 * - New IDs: added as produced (status `potential`).
 * - IDs no longer produced: dropped if still `potential`; kept otherwise (a decision was recorded).
 *
 * @param previous - Findings stored on the case.
 * @param fresh - Findings from the latest `runAudit`.
 * @returns Merged findings: fresh order first, then kept old ones.
 */
export function mergeFindings(previous: Finding[], fresh: Finding[]): Finding[] {
  const old = new Map(previous.map((f) => [f.id, f]));
  const merged = fresh.map((f) => {
    const p = old.get(f.id);
    if (!p) return f;
    if (p.status === "potential") return p.patientExcluded === undefined ? f : { ...f, patientExcluded: p.patientExcluded };
    return { ...f, status: p.status, statusNote: p.statusNote, statusSources: p.statusSources, verified: p.verified, patientExcluded: p.patientExcluded };
  });
  const freshIds = new Set(fresh.map((f) => f.id));
  const kept = previous.filter((f) => !freshIds.has(f.id) && f.status !== "potential");
  return [...merged, ...kept];
}

/**
 * Applies a recorded counterparty response to the findings and tasks.
 *
 * - `confirms_error` → `confirmed` (offered, not yet verified); adds an `await_document` task for
 *   the revised statement unless one is open.
 * - `provides_documentation` → `withdrawn`, citing the attached document (required); closes the
 *   finding's open tasks. No savings are claimed for that charge.
 * - `needs_more_info` → `pending`; the patient must approve requesting the document (see machine).
 * - `will_send_later` → `pending`; adds an `await_document` task with the responsible party and date.
 *
 * @param findings - Current findings.
 * @param tasks - Current tasks.
 * @param response - The structured response.
 * @param ctx - `eventId` of the stored response event, `receivedAt` date, and a task ID factory.
 * @returns New findings and tasks (inputs are not mutated).
 * @throws {CaseRuleError} On an unknown or withdrawn finding, or documentation without a document.
 */
export function applyResponse(
  findings: Finding[],
  tasks: CaseTask[],
  response: CounterpartyResponse,
  ctx: { eventId: string; receivedAt: IsoDate; newTaskId: () => string },
): { findings: Finding[]; tasks: CaseTask[] } {
  const byId = new Map(findings.map((f) => [f.id, f]));
  for (const r of response.perFinding) {
    const f = byId.get(r.findingId);
    if (!f) throw new CaseRuleError(`Unknown finding ${r.findingId}.`);
    if (f.status === "withdrawn") throw new CaseRuleError(`Finding ${r.findingId} was already withdrawn.`);
    if (r.kind === "provides_documentation" && !response.documentId) {
      throw new CaseRuleError("Documentation responses must attach the document.");
    }
  }

  const responseSource: Source = { kind: "response", eventId: ctx.eventId, from: response.from, receivedAt: ctx.receivedAt, note: response.note ?? null };
  const docSource: Source[] = response.documentId
    ? [{ kind: "document", documentId: response.documentId, docType: "correspondence", label: response.documentLabel ?? "Document from the billing office" }]
    : [];
  const on = longDate(ctx.receivedAt);
  let nextTasks = tasks.map((t) => ({ ...t }));
  const updated = new Map<string, Finding>();

  for (const r of response.perFinding) {
    const f = byId.get(r.findingId) as Finding;
    const party = r.responsibleParty ?? response.from;
    const by = r.promisedBy ? ` by ${longDate(r.promisedBy)}` : "";
    if (r.kind === "confirms_error") {
      updated.set(f.id, {
        ...f,
        status: "confirmed",
        verified: false,
        statusNote: `${response.from} confirmed on ${on} that this was billed in error. Savings count as confirmed only after a revised statement shows the correction.`,
        statusSources: [responseSource, ...docSource],
      });
      const open = nextTasks.some((t) => t.status === "open" && t.documentNeeded === REVISED_STATEMENT);
      if (!open) {
        nextTasks.push({ id: ctx.newTaskId(), kind: "await_document", documentNeeded: REVISED_STATEMENT, responsibleParty: party, followUpDate: r.promisedBy ?? null, status: "open" });
      }
    } else if (r.kind === "provides_documentation") {
      updated.set(f.id, {
        ...f,
        status: "withdrawn",
        statusNote: `${response.from} sent documentation on ${on} (${response.documentLabel ?? "attached document"}). This concern is withdrawn, and no savings are claimed for this charge.`,
        statusSources: [responseSource, ...docSource],
      });
      nextTasks = nextTasks.map((t) =>
        t.findingId === f.id && t.status === "open" ? { ...t, status: "done", fulfilledBy: response.documentId } : t,
      );
    } else if (r.kind === "refused") {
      // A denied claim moves to the appeal stage (secondary call); denied again on appeal escalates.
      const onAppeal = f.stage === "appeal";
      updated.set(f.id, {
        ...f,
        status: "pending",
        stage: onAppeal ? "escalated" : "appeal",
        statusNote: onAppeal
          ? `${response.from} denied this again on appeal on ${on}. Next: a written appeal or complaint; a human advocate can help.`
          : `${response.from} denied this claim on ${on} (said the charge is valid, without documentation). Next: appeal the denial on a second call.`,
        statusSources: [...(f.statusSources ?? []), responseSource],
      });
    } else if (r.kind === "needs_more_info") {
      updated.set(f.id, {
        ...f,
        status: "pending",
        statusNote: `${response.from} said on ${on} that more information is needed: ${r.neededDocument ?? "not specified"}. This stays pending until it is provided.`,
        statusSources: [responseSource],
      });
      nextTasks.push({ id: ctx.newTaskId(), kind: "request_document", findingId: f.id, documentNeeded: r.neededDocument ?? "the missing information", responsibleParty: party, followUpDate: null, status: "open" });
    } else {
      updated.set(f.id, {
        ...f,
        status: "pending",
        statusNote: `${response.from} said on ${on} that ${r.neededDocument ?? "the documentation"} will be sent later${by}. This stays pending until it arrives.`,
        statusSources: [responseSource],
      });
      nextTasks.push({ id: ctx.newTaskId(), kind: "await_document", findingId: f.id, documentNeeded: r.neededDocument ?? "documentation", responsibleParty: party, followUpDate: r.promisedBy ?? null, status: "open" });
    }
  }
  return { findings: findings.map((f) => updated.get(f.id) ?? f), tasks: nextTasks };
}

/**
 * Applies a revised-statement comparison: resolved findings become `confirmed` and `verified`;
 * confirmed findings the statement doesn't reflect stay unverified with a note. Closes the open
 * revised-statement task.
 *
 * @param findings - Current findings.
 * @param tasks - Current tasks.
 * @param cmp - Result of `compareRevised`.
 * @param doc - The revised statement's document ID and date received.
 * @returns New findings and tasks.
 */
export function applyVerification(
  findings: Finding[],
  tasks: CaseTask[],
  cmp: RevisedComparison,
  doc: { documentId: string; receivedAt: IsoDate },
): { findings: Finding[]; tasks: CaseTask[] } {
  const source: Source = { kind: "document", documentId: doc.documentId, docType: "revised_statement", label: `Revised statement received ${longDate(doc.receivedAt)}` };
  const resolved = new Set(cmp.resolvedFindingIds);
  const notReflected = new Set(cmp.notReflectedFindingIds);
  const next = findings.map((f): Finding => {
    if (resolved.has(f.id)) {
      const lines = f.lineNumbers.join(", ");
      return {
        ...f,
        status: "confirmed",
        verified: true,
        statusNote: `Verified: the revised statement no longer bills line${f.lineNumbers.length > 1 ? "s" : ""} ${lines}.`,
        statusSources: [...(f.statusSources ?? []), source],
      };
    }
    if (notReflected.has(f.id)) {
      return {
        ...f,
        verified: false,
        statusNote: `The revised statement still bills line${f.lineNumbers.length > 1 ? "s" : ""} ${f.lineNumbers.join(", ")}, so this correction is not verified yet.`,
        statusSources: [...(f.statusSources ?? []), source],
      };
    }
    return f;
  });
  const nextTasks = tasks.map((t) =>
    t.status === "open" && t.documentNeeded === REVISED_STATEMENT ? { ...t, status: "done" as const, fulfilledBy: doc.documentId } : t,
  );
  return { findings: next, tasks: nextTasks };
}

/** The savings trio shown on the case screen (SPEC.md §4.6). Each bill line is counted once. */
export interface Savings {
  /** Amount still in question: findings neither withdrawn nor verified on a revised statement. */
  questionedCents: number;
  /** Amount the office agreed to fix but no revised statement proves yet. */
  offeredCents: number;
  /** Proven by a confirmed revised statement, or `null` before one arrives. */
  confirmedCents: number | null;
}

/**
 * Computes questioned, offered, and confirmed savings.
 *
 * @param bill - The confirmed original bill.
 * @param findings - Current findings.
 * @param cmp - Revised-statement comparison, or `null` if none has been verified.
 * @returns The savings trio; text for display is formatted by the caller with `usd`.
 */
export function computeSavings(bill: ConfirmedBill, findings: Finding[], cmp: RevisedComparison | null): Savings {
  const open = findings.filter((f) => !f.patientExcluded && f.status !== "withdrawn" && !(f.status === "confirmed" && f.verified));
  const offered = open.filter((f) => f.status === "confirmed");
  return {
    questionedCents: computeVerdict(bill, open).questionedCents,
    offeredCents: computeVerdict(bill, offered).questionedCents,
    confirmedCents: cmp ? cmp.confirmedSavingsCents : null,
  };
}
