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
import type { CaseTask, ConfirmedBill, CounterpartyResponse, Draft, Finding, IsoDate, RevisedComparison } from "@/lib/types";
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
import { CaseRuleError, REVISED_STATEMENT, applyResponse, applyVerification, computeSavings, type Savings } from "./responses";
import { getStore, newId, type StoredCase, type StoredDocument } from "./store";
import { compareRevised } from "./verify";

/** Correspondence samples the operator console can attach (`fixtures/documents/<name>.pdf`). */
export const CORRESPONDENCE_SAMPLES: Record<string, string> = {
  "response-confirms": "Letter from Quillhaven billing: duplicate TSH will be removed",
  "lab-result-ft4": "Quillhaven laboratory report: free T4, collected on the visit date",
  "response-incomplete": "Letter from Quillhaven billing: lab record to follow from the laboratory",
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
  phase: CasePhase;
  next: NextAction;
  allowed: AllowedAction[];
  tasks: CaseTask[];
  savings: Savings | null;
  verification: RevisedComparison | null;
  timeline: TimelineEntry[];
}

/**
 * Today's date for case logic. `DEMO_TODAY` (YYYY-MM-DD) pins it for rehearsals.
 *
 * @returns ISO date.
 */
export function today(): IsoDate {
  const pinned = process.env.DEMO_TODAY;
  return pinned && /^\d{4}-\d{2}-\d{2}$/.test(pinned) ? pinned : new Date().toISOString().slice(0, 10);
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
function originalBill(c: StoredCase): { doc: StoredDocument; bill: ConfirmedBill } | null {
  const doc = c.documents.find((d) => d.direction === "incoming" && d.confirmed && d.docType === "itemized_bill");
  return doc ? { doc, bill: doc.confirmed as ConfirmedBill } : null;
}

/** The latest dispute letter draft, if any. */
function disputeDoc(c: StoredCase): StoredDocument | null {
  return c.documents.filter((d) => d.direction === "outgoing" && (d.draft as Draft | null)?.kind === "dispute_letter").at(-1) ?? null;
}

/**
 * Builds the machine's snapshot from the stored case.
 *
 * @param c - Stored case.
 * @returns Snapshot plus the current task list and latest verification.
 */
export function snapshotOf(c: StoredCase): { snapshot: CaseSnapshot; tasks: CaseTask[]; verification: RevisedComparison | null } {
  const tasks = eventsOf<{ tasks: CaseTask[] }>(c, "tasks_updated").at(-1)?.tasks ?? [];
  const dispute = disputeDoc(c);
  const sent = dispute ? eventsOf<{ documentId: string; sentAt: IsoDate }>(c, "dispute_sent").find((e) => e.documentId === dispute.id) : undefined;
  const revisedPending = c.documents.find((d) => d.direction === "incoming" && d.docType === "revised_statement" && !d.confirmed);
  const orig = originalBill(c);
  const snapshot: CaseSnapshot = {
    hasConfirmedBill: Boolean(orig),
    audited: c.events.some((e) => e.type === "audit_run"),
    findings: c.findings,
    tasks,
    dispute: dispute ? { documentId: dispute.id, sent: Boolean(sent), ...(sent ? { sentAt: sent.sentAt } : {}) } : null,
    responsesRecorded: c.events.filter((e) => e.type === "response_recorded").length,
    revisedAwaitingConfirmation: revisedPending ? { documentId: revisedPending.id } : null,
    approvals: eventsOf<{ action: ActionId; target?: string }>(c, "approval_recorded").map((a) => ({ action: a.action, ...(a.target ? { target: a.target } : {}) })),
    billingEntity: orig?.bill.billingEntity ?? null,
  };
  const verification = eventsOf<{ comparison: RevisedComparison }>(c, "revised_verified").at(-1)?.comparison ?? null;
  return { snapshot, tasks, verification };
}

/** Bookkeeping events kept off the timeline (task snapshots and iMessage delivery state). */
const HIDDEN_EVENTS: ReadonlySet<string> = new Set(["tasks_updated", "imessage_link_code", "imessage_prompt", "imessage_outbox", "imessage_superseded", "imessage_notified"]);

/** How an iMessage reply reads on the timeline, by intent. */
const IMESSAGE_REPLY_LABEL: Record<string, string> = { link: "LINK", approve: "A to approve", decline: "B to hold", why: "WHY", status: "STATUS" };

/**
 * Writes a plain summary for a timeline event (templates only).
 *
 * @param type - Event type.
 * @param data - Event data.
 * @returns Summary text.
 */
function summarize(type: string, data: Record<string, unknown>): string {
  switch (type) {
    case "document_received": return `Document received: ${String(data.fileName ?? data.docType ?? "file")}`;
    case "fields_confirmed": return "You confirmed the document's fields";
    case "audit_run": return `Bill checked against your EOB and records: ${(data.findings as unknown[] | undefined)?.length ?? 0} potential issue(s)`;
    case "letter_drafted": return "Dispute letter drafted";
    case "approval_recorded": return `You approved: ${String(data.label ?? data.action)}`;
    case "dispute_sent": return `Dispute letter sent via ${String(data.method)}`;
    case "response_recorded": return `Response from ${String(data.from)}`;
    case "correspondence_attached": return `Attached: ${String(data.label)}`;
    case "document_requested": return `Requested ${String(data.documentNeeded)} from ${String(data.responsibleParty)}`;
    case "follow_up_sent": return `Followed up with ${String(data.responsibleParty)} about the ${String(data.documentNeeded)}`;
    case "handoff": return `You took over: ${String(data.documentNeeded)}`;
    case "revised_verified": return `Revised statement checked: ${usd(Number((data.comparison as RevisedComparison | undefined)?.confirmedSavingsCents ?? 0))} confirmed`;
    case "tasks_updated": return "Tasks updated";
    case "imessage_linked": return "iMessage updates turned on";
    case "imessage_unlinked": return "iMessage updates turned off";
    case "imessage_sent": return "Update sent by iMessage";
    case "imessage_reply": return `You texted ${IMESSAGE_REPLY_LABEL[String(data.intent)] ?? String(data.intent)}${data.result === "approved" ? " (approved)" : data.result === "declined" ? " (holding)" : ""}`;
    default: return type.replaceAll("_", " ");
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
  return {
    phase: derivePhase(snapshot),
    next: recommendAction(snapshot, d),
    allowed: allowedActions(snapshot, d),
    tasks,
    savings: orig && snapshot.audited ? computeSavings(orig.bill, c.findings, verification) : null,
    verification,
    timeline: c.events
      .filter((e) => !HIDDEN_EVENTS.has(e.type))
      .map((e) => ({ at: e.createdAt, type: e.type, summary: summarize(e.type, (e.data ?? {}) as Record<string, unknown>) })),
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
export async function runCaseAction(caseId: string, input: { actionId: ActionId; target?: string; approve?: boolean }): Promise<CaseState> {
  const store = getStore();
  const c = await load(caseId);
  const { snapshot, tasks } = snapshotOf(c);
  const d = today();
  const { actionId, target } = input;
  const listed = allowedActions(snapshot, d).find((a) => a.id === actionId && (a.target ?? undefined) === target);
  if (!listed) throw new ActionRefusedError(`"${actionId}" is not allowed right now.`);
  if (NEEDS_APPROVAL.has(actionId)) {
    if (!input.approve && !listed.approved) throw new ActionRefusedError(`"${listed.label}" needs your approval first.`);
    if (!listed.approved) {
      await store.addEvent(caseId, "approval_recorded", { action: actionId, ...(target ? { target } : {}), label: listed.label, approvedBy: "patient" });
      snapshot.approvals.push({ action: actionId, ...(target ? { target } : {}) });
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
      await store.addEvent(caseId, "dispute_sent", { documentId: doc.id, method: "patient portal (simulated)", sentAt: d });
      break;
    }
    case "request_document": {
      if (!task) throw new ActionRefusedError("Unknown task");
      const next = tasks.map((t) => (t.id === task.id ? { ...t, kind: "await_document" as const, followUpDate: addDays(d, 7) } : t));
      await store.addEvent(caseId, "document_requested", { taskId: task.id, documentNeeded: task.documentNeeded, responsibleParty: task.responsibleParty, method: "patient portal (simulated)" });
      await saveTasks(caseId, next);
      break;
    }
    case "request_revised_statement": {
      const party = snapshot.billingEntity ?? "the billing office";
      await store.addEvent(caseId, "document_requested", { documentNeeded: REVISED_STATEMENT, responsibleParty: party, method: "patient portal (simulated)" });
      await saveTasks(caseId, [...tasks, { id: newId("task"), kind: "await_document", documentNeeded: REVISED_STATEMENT, responsibleParty: party, followUpDate: addDays(d, 10), status: "open" }]);
      break;
    }
    case "follow_up": {
      if (!task) throw new ActionRefusedError("Unknown task");
      await store.addEvent(caseId, "follow_up_sent", { taskId: task.id, documentNeeded: task.documentNeeded, responsibleParty: task.responsibleParty, method: "patient portal (simulated)" });
      await saveTasks(caseId, tasks.map((t) => (t.id === task.id ? { ...t, followUpDate: addDays(d, 7) } : t)));
      break;
    }
    case "patient_takes_over": {
      if (!task) throw new ActionRefusedError("Unknown task");
      await store.addEvent(caseId, "handoff", { taskId: task.id, documentNeeded: task.documentNeeded, reason: "patient chose to handle it" });
      await saveTasks(caseId, tasks.map((t) => (t.id === task.id ? { ...t, status: "patient_handling" as const } : t)));
      break;
    }
    default:
      // draft_dispute, run_audit, confirm_documents, attach_document, confirm_revised_statement and
      // wait have their own endpoints (letters, audit, documents, confirm); nothing to do here.
      throw new ActionRefusedError(`"${actionId}" is done from its own screen, not as a case action.`);
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
export async function attachCorrespondence(caseId: string, name: string): Promise<{ documentId: string; label: string }> {
  const label = CORRESPONDENCE_SAMPLES[name];
  if (!label) throw new CaseRuleError(`Unknown correspondence sample ${name}`);
  await load(caseId);
  const store = getStore();
  const key = await store.putFile(new Uint8Array(readFileSync(join(process.cwd(), "fixtures", "documents", `${name}.pdf`))), "application/pdf");
  const documentId = newId("doc");
  await store.saveDocument({ id: documentId, caseId, docType: "correspondence", direction: "incoming", status: "received", fileName: `${name}.pdf (sample)`, storageKey: key, extraction: null, extractionMeta: null, confirmed: null, draft: null });
  await store.addEvent(caseId, "correspondence_attached", { documentId, label });
  return { documentId, label };
}

/** Validates a response posted by the operator console. */
export const CounterpartyResponseSchema = z.object({
  from: z.string().min(1).max(200),
  perFinding: z
    .array(
      z.object({
        findingId: z.string().min(1),
        kind: z.enum(["confirms_error", "provides_documentation", "needs_more_info", "will_send_later"]),
        neededDocument: z.string().max(200).optional(),
        responsibleParty: z.string().max(200).optional(),
        promisedBy: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
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
export async function recordResponse(caseId: string, response: CounterpartyResponse & { attachSample?: string }): Promise<CaseState> {
  const store = getStore();
  const { attachSample, ...r } = response;
  const resp: CounterpartyResponse = { ...r };
  if (attachSample) {
    const att = await attachCorrespondence(caseId, attachSample);
    resp.documentId = att.documentId;
    resp.documentLabel ??= att.label;
  }
  const c = await load(caseId);
  if (resp.documentId && !c.documents.some((d) => d.id === resp.documentId)) throw new CaseRuleError("That document isn't on this case.");
  const { tasks } = snapshotOf(c);
  const eventId = newId("resp");
  const d = today();
  // Validate first (throws before anything is stored), then store the event, then apply.
  const applied = applyResponse(c.findings, tasks, resp, { eventId, receivedAt: d, newTaskId: () => newId("task") });
  await store.addEvent(caseId, "response_recorded", { eventId, ...resp, receivedAt: d });
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
export async function verifyRevisedStatement(caseId: string, documentId: string): Promise<RevisedComparison | null> {
  const store = getStore();
  const c = await load(caseId);
  const orig = originalBill(c);
  const doc = c.documents.find((d) => d.id === documentId);
  if (!orig || !doc?.confirmed) return null;
  const { tasks } = snapshotOf(c);
  const cmp = compareRevised(orig.bill, doc.confirmed as ConfirmedBill, c.findings);
  const v = applyVerification(c.findings, tasks, cmp, { documentId, receivedAt: today() });
  await store.saveFindings(caseId, v.findings);
  await saveTasks(caseId, v.tasks);
  await store.addEvent(caseId, "revised_verified", { documentId, comparison: cmp });
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
  return f.status === "confirmed" ? (f.verified ? "confirmed, verified" : "confirmed, awaiting revised statement") : f.status;
}
