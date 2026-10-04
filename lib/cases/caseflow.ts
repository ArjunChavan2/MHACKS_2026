/**
 * @file The adaptive case service (SPEC.md §3, §4.6–4.7, §6 MVP 2): turns the stored case into a
 * `CaseSnapshot`, runs approved actions, records counterparty responses, and verifies revised
 * statements. Decisions come from the pure core (`machine.ts`, `responses.ts`, `verify.ts`).
 *
 * Persistence without a schema change: tasks, approvals, sends, responses, and verifications are
 * stored as case events in `case_events` (latest `tasks_updated` holds the task list). Findings keep
 * their status in `findings.body`. Nothing here sends anything for real: "sent" means recorded as
 * sent via the portal (simulated) after the patient's approval.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { usd } from "@/lib/format";
import type {
  CaseTask,
  ConfirmedBill,
  ConfirmedDenial,
  CounterpartyResponse,
  Draft,
  Finding,
  IsoDate,
  RevisedComparison,
} from "@/lib/types";
import {
  NEEDS_APPROVAL,
  allowedActions,
  canRun,
  derivePhase,
  recommendAction,
  type ActionId,
  type AllowedAction,
  type CasePhase,
  type CaseSnapshot,
  type NextAction,
} from "./machine";
import {
  CaseRuleError,
  REVISED_STATEMENT,
  applyResponse,
  applyVerification,
  computeSavings,
  type Savings,
} from "./responses";
import { getStore, newId, type StoredCase, type StoredDocument } from "./store";
import { assertMatchingRevision } from "./attachments";
import { compareRevised } from "./verify";
import {
  CasePreferencesSchema,
  preferencesOf,
  type CasePreferences,
  type CasePreferencesInput,
} from "./preferences";
import {
  fetchCall,
  latestFinishedCallId,
  type CallRecord,
} from "@/lib/calls/history";
import { consentStateOf, type ConsentState } from "./consent";
import { proposeOutcome, type CallOutcome } from "./callOutcome";

/** Correspondence samples the operator console can attach (`fixtures/documents/<name>.pdf`). */
export const CORRESPONDENCE_SAMPLES: Record<string, string> = {
  "response-confirms":
    "Letter from Quillhaven billing: duplicate TSH will be removed",
  "lab-result-ft4":
    "Quillhaven laboratory report: free T4, collected on the visit date",
  "response-incomplete":
    "Letter from Quillhaven billing: lab record to follow from the laboratory",
};

/** Thrown when a case action is refused (not allowed now, or not approved). */
export class ActionRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ActionRefusedError";
  }
}

/** One line of the case timeline. */
export interface TimelineEntry {
  at: string;
  type: string;
  /** Plain-language summary written by code. */
  summary: string;
}

/** Everything the case screen needs (added to the existing case view). */
export interface CaseState {
  /** Patient goal and supported restrictions, read from the latest saved event. */
  preferences: CasePreferences;
  phase: CasePhase;
  next: NextAction;
  allowed: AllowedAction[];
  tasks: CaseTask[];
  savings: Savings | null;
  verification: RevisedComparison | null;
  timeline: TimelineEntry[];
  /** Calls saved to this case, oldest first, with transcripts as recorded. */
  calls: CallRecord[];
  /** Live-call consent (demo stand-in for identity verification). */
  consent: ConsentState;
  /** Proposed outcome per saved call awaiting the patient's decision (keyed by conversation ID). */
  callProposals: Record<string, CallOutcome>;
  /** The patient's decision per call outcome. */
  callDecisions: Record<string, "confirmed" | "rejected">;
  /** When this case last pressed "Get Billy ready for a call", or null. */
  callArmedAt: string | null;
}

/**
 * Today's date for case logic. `DEMO_TODAY` (YYYY-MM-DD) pins it for rehearsals.
 *
 * @returns ISO date.
 */
export function today(): IsoDate {
  const pinned = process.env.DEMO_TODAY;
  return pinned && /^\d{4}-\d{2}-\d{2}$/.test(pinned)
    ? pinned
    : new Date().toISOString().slice(0, 10);
}

/**
 * Adds days to an ISO date.
 *
 * @param d - ISO date.
 * @param days - Days to add.
 * @returns ISO date.
 */
function addDays(d: IsoDate, days: number): IsoDate {
  const t = new Date(`${d}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + days);
  return t.toISOString().slice(0, 10);
}

/** Events of one type, oldest first. */
function eventsOf<T>(c: StoredCase, type: string): T[] {
  return c.events.filter((e) => e.type === type).map((e) => e.data as T);
}

/** The case's original confirmed bill (first confirmed itemized bill that isn't a revision). */
function originalBill(
  c: StoredCase,
): { doc: StoredDocument; bill: ConfirmedBill } | null {
  const doc = c.documents.find(
    (d) =>
      d.direction === "incoming" &&
      d.confirmed &&
      d.docType === "itemized_bill",
  );
  return doc ? { doc, bill: doc.confirmed as ConfirmedBill } : null;
}

/** The latest dispute letter draft, if any. */
function disputeDoc(c: StoredCase): StoredDocument | null {
  return (
    c.documents
      .filter(
        (d) =>
          d.direction === "outgoing" &&
          d.status !== "superseded" &&
          (d.draft as Draft | null)?.kind === "dispute_letter",
      )
      .at(-1) ?? null
  );
}

/**
 * Builds the machine's snapshot from the stored case.
 *
 * @param c - Stored case.
 * @returns Snapshot plus the current task list and latest verification.
 */
export function snapshotOf(c: StoredCase): {
  snapshot: CaseSnapshot;
  tasks: CaseTask[];
  verification: RevisedComparison | null;
} {
  const tasks =
    eventsOf<{ tasks: CaseTask[] }>(c, "tasks_updated").at(-1)?.tasks ?? [];
  const dispute = disputeDoc(c);
  const sent = dispute
    ? eventsOf<{ documentId: string; sentAt: IsoDate }>(c, "dispute_sent").find(
        (e) => e.documentId === dispute.id,
      )
    : undefined;
  const revisedPending = c.documents.find(
    (d) =>
      d.direction === "incoming" &&
      d.docType === "revised_statement" &&
      !d.confirmed,
  );
  const orig = originalBill(c);
  const preferences = preferencesOf(c);
  const preferenceIndex = c.events.findLastIndex(
    (e) => e.type === "case_preferences_updated",
  );
  const snapshot: CaseSnapshot = {
    preferences,
    hasConfirmedBill: Boolean(orig),
    audited: c.events
      .slice(c.events.findLastIndex((e) => e.type === "review_reopened") + 1)
      .some((e) => e.type === "audit_run"),
    findings: c.findings,
    tasks,
    dispute: dispute
      ? {
          documentId: dispute.id,
          sent: Boolean(sent),
          ...(sent ? { sentAt: sent.sentAt } : {}),
        }
      : null,
    responsesRecorded: c.events.filter((e) => e.type === "response_recorded")
      .length,
    revisedAwaitingConfirmation: revisedPending
      ? { documentId: revisedPending.id }
      : null,
    approvals: c.events
      .slice(preferenceIndex + 1)
      .filter((e) => e.type === "approval_recorded")
      .map((e) => e.data as { action: ActionId; target?: string })
      .map((a) => ({
        action: a.action,
        ...(a.target ? { target: a.target } : {}),
      })),
    billingEntity: orig?.bill.billingEntity ?? null,
  };
  const verification =
    eventsOf<{ comparison: RevisedComparison }>(c, "revised_verified").at(-1)
      ?.comparison ?? null;
  return { snapshot, tasks, verification };
}

/** Bookkeeping events kept off the timeline (task snapshots and iMessage delivery state). */
const HIDDEN_EVENTS: ReadonlySet<string> = new Set([
  "call_session_updated",
  "call_briefed",
  "tasks_updated",
  "imessage_link_code",
  "imessage_prompt",
  "imessage_outbox",
  "imessage_superseded",
  "imessage_notified",
  "imessage_direct",
]);

/** How an iMessage reply reads on the timeline, by intent. */
const IMESSAGE_REPLY_LABEL: Record<string, string> = {
  link: "LINK",
  approve: "A to approve",
  decline: "B to hold",
  why: "WHY",
  status: "STATUS",
};

/**
 * Writes a plain summary for a timeline event (templates only).
 *
 * @param type - Event type.
 * @param data - Event data.
 * @returns Summary text.
 */
function summarize(type: string, data: Record<string, unknown>): string {
  switch (type) {
    case "letter_recipient_saved":
      return "You saved the email recipient for your letter; nothing was sent";
    case "letter_edited":
      return data.reset ? "You reset the letter to its original wording" : "You saved personalized letter wording; the final version needs your approval";
    case "finding_selection_changed":
      return data.excluded ? "You excluded an issue from your dispute; its evidence is preserved" : "You restored an issue to your dispute";
    case "review_reopened":
      return "You reopened the document details; previous findings and drafts need a new review";
    case "document_received":
      return `Document received: ${String(data.fileName ?? data.docType ?? "file")}`;
    case "case_preferences_updated":
      return "You updated your goal and contact restrictions";
    case "case_document_attached":
      return "You added a document to this case; confirmation is required";
    case "case_document_checked":
      return "Your confirmed document was checked against this case";
    case "fields_confirmed":
      return "You confirmed the document's fields";
    case "audit_run":
      return `Bill checked against your EOB and records: ${(data.findings as unknown[] | undefined)?.length ?? 0} potential issue(s)`;
    case "letter_drafted":
      return "Dispute letter drafted";
    case "approval_recorded":
      return `You approved: ${String(data.label ?? data.action)}`;
    case "dispute_sent":
      return `Dispute letter sent via ${String(data.method)}`;
    case "response_recorded":
      return `Response from ${String(data.from)}`;
    case "correspondence_attached":
      return `Attached: ${String(data.label)}`;
    case "document_requested":
      return `Requested ${String(data.documentNeeded)} from ${String(data.responsibleParty)}`;
    case "follow_up_sent":
      return `Followed up with ${String(data.responsibleParty)} about the ${String(data.documentNeeded)}`;
    case "handoff":
      return `You took over: ${String(data.documentNeeded)}`;
    case "revised_verified":
      return `Revised statement checked: ${usd(Number((data.comparison as RevisedComparison | undefined)?.confirmedSavingsCents ?? 0))} confirmed`;
    case "tasks_updated":
      return "Tasks updated";
    case "imessage_linked":
      return "iMessage updates turned on";
    case "imessage_unlinked":
      return "iMessage updates turned off";
    case "imessage_sent":
      return "Update sent by iMessage";
    case "imessage_reply":
      return `You texted ${IMESSAGE_REPLY_LABEL[String(data.intent)] ?? String(data.intent)}${data.result === "approved" ? " (approved)" : data.result === "declined" ? " (holding)" : ""}`;
    case "call_review_approved":
      return `You approved a ${data.mode === "rehearsal" ? "synthetic rehearsal" : "call"} plan for ${String(data.recipient)}`;
    case "call_outcome_reviewed":
      return `You reviewed the call outcome: ${String(data.nextStep).replaceAll("_", " ")}${data.dueDate ? `, follow-up proposed for ${String(data.dueDate)}` : ""}`;
    case "appeal_evaluated":
      return "Denial criteria checked; correspondence prepared for your review";
    case "call_outcome_decided":
      return data.decision === "confirmed"
        ? "You confirmed what Billy heard on the call"
        : "You marked Billy's summary of a call as not right";
    case "call_recorded":
      return `Call saved: ${Math.round(Number(data.durationSecs ?? 0) / 60) || "<1"} min, ${(data.transcript as unknown[] | undefined)?.length ?? 0} turns`;
    case "consent_requested":
      return `Billy asked for your consent on a call with ${String(data.counterparty ?? "the billing office")}`;
    case "patient_question_asked":
      return `Billy asked you by text, for ${String(data.counterparty ?? "the office")}: “${String(data.question ?? "")}”`;
    case "patient_question_answered":
      return data.outcome === "answered" ? "You answered Billy's question by text (shared on the call)" : data.outcome === "skipped" ? "You chose not to share that" : data.outcome === "withheld" ? "Your reply wasn't shared (it looked like an SSN or card number)" : "Your reply came after the call moved on (not shared)";
    case "call_armed":
      return "You got Billy ready to call about this case";
    case "consent_given":
      return `You consented to Billy representing you (by iMessage)`;
    default:
      return type.replaceAll("_", " ");
  }
}

/**
 * Computes the case screen state from the stored case.
 *
 * @param c - Stored case.
 * @returns Phase, next action, allowed actions, tasks, savings, verification, timeline.
 */
export function caseStateOf(c: StoredCase): CaseState {
  const { snapshot, tasks, verification } = snapshotOf(c);
  const d = today();
  const orig = originalBill(c);
  /** Denial-only cases have correspondence review steps, rather than billing intake actions. */
  const denialDoc = !c.documents.some(
    (doc) => doc.direction === "incoming" && doc.docType !== "denial_letter",
  )
    ? c.documents.find(
        (doc) =>
          doc.direction === "incoming" && doc.docType === "denial_letter",
      )
    : undefined;
  const denial = denialDoc?.confirmed as ConfirmedDenial | undefined;
  const evaluated = c.events.some((event) => event.type === "appeal_evaluated");
  const denialNext: NextAction | null = denialDoc
    ? {
        actionId: "wait",
        title: evaluated
          ? "Review your denial correspondence"
          : denial
            ? "Check the named policy criteria"
            : "Confirm your denial notice",
        why: evaluated
          ? "Your notice and original records support a prepared appeal or documentation request. Review it before using it; nothing has been sent."
          : "The confirmed notice is needed before the fixed policy rules can be checked. Unsupported policies require human review.",
        needed: evaluated
          ? "Your review of the saved draft and its citations"
          : "Confirmed notice and supported policy",
        responsibleParty: "You",
        deadline: denial?.appealDeadline ?? "unconfirmed",
        overdue: Boolean(denial?.appealDeadline && denial.appealDeadline < d),
        needsApproval: false,
        citedFindingIds: [],
      }
    : null;
  return {
    preferences: preferencesOf(c),
    phase:
      denialNext && evaluated ? "awaiting_approval" : derivePhase(snapshot),
    next: denialNext ?? recommendAction(snapshot, d),
    allowed: denialNext ? [] : allowedActions(snapshot, d),
    tasks,
    savings:
      orig && snapshot.audited
        ? computeSavings(orig.bill, c.findings, verification)
        : null,
    verification,
    calls: eventsOf<CallRecord>(c, "call_recorded"),
    consent: consentStateOf(c),
    callArmedAt:
      c.events.filter((e) => e.type === "call_armed").at(-1)?.createdAt ?? null,
    callDecisions: Object.fromEntries(
      eventsOf<{ conversationId: string; decision: "confirmed" | "rejected" }>(
        c,
        "call_outcome_decided",
      ).map((d) => [d.conversationId, d.decision]),
    ),
    callProposals: Object.fromEntries(
      eventsOf<CallRecord>(c, "call_recorded")
        .filter(
          (call) =>
            !eventsOf<{ conversationId: string }>(
              c,
              "call_outcome_decided",
            ).some((d) => d.conversationId === call.conversationId),
        )
        .flatMap((call) => {
          const p = proposeOutcome(
            call,
            c.findings,
            orig?.bill.billingEntity ?? "the billing office",
          );
          return p ? [[call.conversationId, p] as const] : [];
        }),
    ),
    timeline: c.events
      .filter((e) => !HIDDEN_EVENTS.has(e.type))
      .map((e) => ({
        at: e.createdAt,
        type: e.type,
        summary: summarize(e.type, (e.data ?? {}) as Record<string, unknown>),
      })),
  };
}

/**
 * Loads a case or throws.
 *
 * @param caseId - Case ID.
 * @returns The stored case.
 * @throws {CaseRuleError} When the case doesn't exist.
 */
async function load(caseId: string): Promise<StoredCase> {
  const c = await getStore().getCase(caseId);
  if (!c) throw new CaseRuleError("Unknown case");
  return c;
}

/**
 * Saves a new task list and the phase label.
 *
 * @param caseId - Case ID.
 * @param tasks - Full task list.
 */
async function saveTasks(caseId: string, tasks: CaseTask[]): Promise<void> {
  await getStore().addEvent(caseId, "tasks_updated", { tasks });
}

/** Re-derives the phase and stores it as the case status label. */
async function syncPhase(caseId: string): Promise<CaseState> {
  const state = caseStateOf(await load(caseId));
  await getStore().setCaseStatus(caseId, state.phase);
  return state;
}

/**
 * Runs a case action. Actions that need approval require `approve: true` (the patient's click is
 * the approval, recorded as an event before the action runs). Refused if not allowed right now.
 *
 * @param caseId - Case ID.
 * @param input - Action, optional target (task or document ID), and approval.
 * @returns The new case state.
 * @throws {ActionRefusedError} When the action is not allowed or not approved.
 */
export async function runCaseAction(
  caseId: string,
  input: { actionId: ActionId; target?: string; approve?: boolean },
): Promise<CaseState> {
  const store = getStore();
  const c = await load(caseId);
  const { snapshot, tasks } = snapshotOf(c);
  const d = today();
  const { actionId, target } = input;
  const listed = allowedActions(snapshot, d).find(
    (a) => a.id === actionId && (a.target ?? undefined) === target,
  );
  if (!listed)
    throw new ActionRefusedError(`"${actionId}" is not allowed right now.`);
  if (NEEDS_APPROVAL.has(actionId)) {
    if (!input.approve && !listed.approved)
      throw new ActionRefusedError(
        `"${listed.label}" needs your approval first.`,
      );
    if (!listed.approved) {
      await store.addEvent(caseId, "approval_recorded", {
        action: actionId,
        ...(target ? { target } : {}),
        label: listed.label,
        approvedBy: "patient",
      });
      snapshot.approvals.push({
        action: actionId,
        ...(target ? { target } : {}),
      });
    }
  }
  const check = canRun(snapshot, actionId, d, target);
  if (!check.ok) throw new ActionRefusedError(check.reason);

  const task = tasks.find((t) => t.id === target);
  switch (actionId) {
    case "send_dispute": {
      const doc = c.documents.find((x) => x.id === target);
      if (!doc) throw new ActionRefusedError("Unknown letter");
      await store.saveDocument({ ...doc, status: "sent" });
      await store.addEvent(caseId, "dispute_sent", {
        documentId: doc.id,
        method: "patient portal (simulated)",
        sentAt: d,
      });
      break;
    }
    case "request_document": {
      if (!task) throw new ActionRefusedError("Unknown task");
      const next = tasks.map((t) =>
        t.id === task.id
          ? {
              ...t,
              kind: "await_document" as const,
              followUpDate: addDays(d, 7),
            }
          : t,
      );
      await store.addEvent(caseId, "document_requested", {
        taskId: task.id,
        documentNeeded: task.documentNeeded,
        responsibleParty: task.responsibleParty,
        method: "patient portal (simulated)",
      });
      await saveTasks(caseId, next);
      break;
    }
    case "request_revised_statement": {
      const party = snapshot.billingEntity ?? "the billing office";
      await store.addEvent(caseId, "document_requested", {
        documentNeeded: REVISED_STATEMENT,
        responsibleParty: party,
        method: "patient portal (simulated)",
      });
      await saveTasks(caseId, [
        ...tasks,
        {
          id: newId("task"),
          kind: "await_document",
          documentNeeded: REVISED_STATEMENT,
          responsibleParty: party,
          followUpDate: addDays(d, 10),
          status: "open",
        },
      ]);
      break;
    }
    case "follow_up": {
      if (!task) throw new ActionRefusedError("Unknown task");
      await store.addEvent(caseId, "follow_up_sent", {
        taskId: task.id,
        documentNeeded: task.documentNeeded,
        responsibleParty: task.responsibleParty,
        method: "patient portal (simulated)",
      });
      await saveTasks(
        caseId,
        tasks.map((t) =>
          t.id === task.id ? { ...t, followUpDate: addDays(d, 7) } : t,
        ),
      );
      break;
    }
    case "patient_takes_over": {
      if (!task) throw new ActionRefusedError("Unknown task");
      await store.addEvent(caseId, "handoff", {
        taskId: task.id,
        documentNeeded: task.documentNeeded,
        reason: "patient chose to handle it",
      });
      await saveTasks(
        caseId,
        tasks.map((t) =>
          t.id === task.id ? { ...t, status: "patient_handling" as const } : t,
        ),
      );
      break;
    }
    default:
      // draft_dispute, run_audit, confirm_documents, attach_document, confirm_revised_statement and
      // wait have their own endpoints (letters, audit, documents, confirm); nothing to do here.
      throw new ActionRefusedError(
        `"${actionId}" is done from its own screen, not as a case action.`,
      );
  }
  return syncPhase(caseId);
}

/**
 * Attaches a correspondence sample (a letter or lab report from the office) to the case. The file is
 * stored privately and cited by ID; its contents are never read by a model.
 *
 * @param caseId - Case ID.
 * @param name - Key of `CORRESPONDENCE_SAMPLES`.
 * @returns The new document ID and label.
 * @throws {CaseRuleError} For an unknown sample.
 */
export async function attachCorrespondence(
  caseId: string,
  name: string,
): Promise<{ documentId: string; label: string }> {
  const label = CORRESPONDENCE_SAMPLES[name];
  if (!label) throw new CaseRuleError(`Unknown correspondence sample ${name}`);
  await load(caseId);
  const store = getStore();
  const key = await store.putFile(
    new Uint8Array(
      readFileSync(join(process.cwd(), "fixtures", "documents", `${name}.pdf`)),
    ),
    "application/pdf",
  );
  const documentId = newId("doc");
  await store.saveDocument({
    id: documentId,
    caseId,
    docType: "correspondence",
    direction: "incoming",
    status: "received",
    fileName: `${name}.pdf (sample)`,
    storageKey: key,
    extraction: null,
    extractionMeta: null,
    confirmed: null,
    draft: null,
  });
  await store.addEvent(caseId, "correspondence_attached", {
    documentId,
    label,
  });
  return { documentId, label };
}

/** Validates a response posted by the operator console. */
export const CounterpartyResponseSchema = z.object({
  from: z.string().min(1).max(200),
  perFinding: z
    .array(
      z.object({
        findingId: z.string().min(1),
        kind: z.enum([
          "confirms_error",
          "provides_documentation",
          "needs_more_info",
          "will_send_later",
          "refused",
        ]),
        neededDocument: z.string().max(200).optional(),
        responsibleParty: z.string().max(200).optional(),
        promisedBy: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional(),
      }),
    )
    .min(1),
  documentId: z.string().optional(),
  documentLabel: z.string().max(200).optional(),
  note: z.string().max(2000).optional(),
});

/**
 * Records a counterparty response (from the simulated operator console) and applies it.
 *
 * @param caseId - Case ID.
 * @param response - The structured response; `attachSample` attaches a correspondence sample first.
 * @returns The new case state.
 * @throws {CaseRuleError} For unknown findings, withdrawn findings, missing documents, or a document from another case.
 */
export async function recordResponse(
  caseId: string,
  response: CounterpartyResponse & { attachSample?: string },
): Promise<CaseState> {
  const store = getStore();
  const { attachSample, ...r } = response;
  const resp: CounterpartyResponse = { ...r };
  if (attachSample) {
    const att = await attachCorrespondence(caseId, attachSample);
    resp.documentId = att.documentId;
    resp.documentLabel ??= att.label;
  }
  const c = await load(caseId);
  if (resp.documentId && !c.documents.some((d) => d.id === resp.documentId))
    throw new CaseRuleError("That document isn't on this case.");
  const { tasks } = snapshotOf(c);
  const eventId = newId("resp");
  const d = today();
  // Validate first (throws before anything is stored), then store the event, then apply.
  const applied = applyResponse(c.findings, tasks, resp, {
    eventId,
    receivedAt: d,
    newTaskId: () => newId("task"),
  });
  await store.addEvent(caseId, "response_recorded", {
    eventId,
    ...resp,
    receivedAt: d,
  });
  await store.saveFindings(caseId, applied.findings);
  await saveTasks(caseId, applied.tasks);
  return syncPhase(caseId);
}

/**
 * Verifies a just-confirmed revised statement against the original bill and updates findings,
 * tasks, and confirmed savings. Called by `confirmDocument` after the patient confirms it.
 *
 * @param caseId - Case ID.
 * @param documentId - The confirmed revised statement.
 * @returns The comparison, or `null` when there is no confirmed original bill to compare with.
 */
export async function verifyRevisedStatement(
  caseId: string,
  documentId: string,
): Promise<RevisedComparison | null> {
  const store = getStore();
  const c = await load(caseId);
  const orig = originalBill(c);
  const doc = c.documents.find((d) => d.id === documentId);
  if (!orig || !doc?.confirmed) return null;
  if (doc.docType !== "revised_statement")
    throw new CaseRuleError("Verification requires a revised statement.");
  assertMatchingRevision(orig.bill, doc.confirmed as ConfirmedBill);
  const { tasks } = snapshotOf(c);
  const cmp = compareRevised(
    orig.bill,
    doc.confirmed as ConfirmedBill,
    c.findings,
  );
  const v = applyVerification(c.findings, tasks, cmp, {
    documentId,
    receivedAt: today(),
  });
  await store.saveFindings(caseId, v.findings);
  await saveTasks(caseId, v.tasks);
  await store.addEvent(caseId, "revised_verified", {
    documentId,
    comparison: cmp,
  });
  await syncPhase(caseId);
  return cmp;
}

/**
 * Describes a finding's status for plain text (e.g. operator console lists).
 *
 * @param f - Finding.
 * @returns e.g. "confirmed, verified" or "pending".
 */
export function statusLabel(f: Finding): string {
  return f.status === "confirmed"
    ? f.verified
      ? "confirmed, verified"
      : "confirmed, awaiting revised statement"
    : f.status;
}

/**
 * Saves explicit case preferences as a versioned event; old approvals cease to authorize contact.
 * @param caseId - Existing case ID.
 * @param input - Validated patient goal and supported restrictions.
 * @returns Refreshed case state after persistence.
 * @throws {CaseRuleError} For an unknown case or invalid choices. Side effects: appends one event.
 */
export async function saveCasePreferences(
  caseId: string,
  input: CasePreferencesInput,
): Promise<CaseState> {
  await load(caseId);
  const parsed = CasePreferencesSchema.safeParse(input);
  if (!parsed.success)
    throw new CaseRuleError(
      "Enter a goal and choose the supported restrictions.",
    );
  await getStore().addEvent(caseId, "case_preferences_updated", {
    ...parsed.data,
    version: newId("pref"),
  });
  return syncPhase(caseId);
}

/**
 * Saves a finished call (transcript as recorded by ElevenLabs) to the case. The same call can't be
 * saved twice.
 *
 * Side effects: reads ElevenLabs; appends a `call_recorded` event.
 *
 * @param caseId - Case ID.
 * @param conversationId - ElevenLabs conversation ID, or omitted for the agent's latest finished call.
 * @returns The new case state.
 * @throws {CaseRuleError} When the case is unknown or the call is already saved.
 * @throws {import("@/lib/calls").CallError} When ElevenLabs can't provide the call.
 */
export async function addCallToCase(
  caseId: string,
  conversationId?: string,
): Promise<CaseState> {
  const c = await load(caseId);
  const id = conversationId ?? (await latestFinishedCallId());
  if (
    eventsOf<CallRecord>(c, "call_recorded").some(
      (r) => r.conversationId === id,
    )
  )
    throw new CaseRuleError("That call is already saved to this case.");
  const record = await fetchCall(id);
  await getStore().addEvent(caseId, "call_recorded", record);
  return caseStateOf(await load(caseId));
}

/**
 * Applies (or rejects) the proposed outcome of a saved call, after the patient reviews it.
 * Confirmed answers go through `recordResponse` (same rules as any response); a failed or unresolved
 * call opens a follow-up request so the case never waits silently.
 *
 * @param caseId - Case ID.
 * @param conversationId - The saved call.
 * @param decision - "confirm" or "reject".
 * @returns The new case state.
 * @throws {CaseRuleError} When the call isn't saved, has no proposal, or was already decided.
 */
export async function decideCallOutcome(
  caseId: string,
  conversationId: string,
  decision: "confirm" | "reject",
): Promise<CaseState> {
  const c = await load(caseId);
  const state = caseStateOf(c);
  const proposal = state.callProposals[conversationId];
  if (!proposal)
    throw new CaseRuleError("There's no pending summary for that call.");
  const store = getStore();
  if (decision === "reject") {
    await store.addEvent(caseId, "call_outcome_decided", {
      conversationId,
      decision: "rejected",
    });
    return caseStateOf(await load(caseId));
  }
  if (proposal.kind === "response") {
    await recordResponse(caseId, proposal.response);
  } else {
    const { tasks } = snapshotOf(await load(caseId));
    const office = originalBill(c)?.bill.billingEntity ?? "the billing office";
    const what =
      proposal.reason === "consent_not_given"
        ? "a call back once the patient has verified"
        : "a response to the dispute (follow up by phone or in writing)";
    await saveTasks(caseId, [
      ...tasks,
      {
        id: newId("task"),
        kind: "request_document",
        documentNeeded: what,
        responsibleParty: office,
        followUpDate: null,
        status: "open",
      },
    ]);
  }
  await store.addEvent(caseId, "call_outcome_decided", {
    conversationId,
    decision: "confirmed",
    outcome: proposal.kind === "response" ? "response" : proposal.reason,
  });
  return syncPhase(caseId);
}
