/**
 * @file The case state machine: phase, allowed actions, and the "What happens next?" card
 * (SPEC.md §3.2–3.9, §4.7). Pure and deterministic; never uses an LLM.
 *
 * The agent (or patient) may only take an action listed by `allowedActions`. Actions that contact
 * someone or commit to something need a recorded approval first (`canRun`). The card's text comes
 * from templates here, citing findings by ID; an LLM never writes it.
 */
import { longDate } from "@/lib/format";
import type { CaseTask, Finding, IsoDate } from "@/lib/types";
import type { CasePreferences } from "./preferences";
import { REVISED_STATEMENT } from "./responses";

/** Where a case is (stored in `cases.status`; always re-derived from the case's facts). */
export type CasePhase =
  | "intake"
  | "audited"
  | "awaiting_approval"
  | "waiting_response"
  | "waiting_document"
  | "verifying"
  | "resolved";

/** Every action the case can take. */
export type ActionId =
  | "confirm_documents"
  | "run_audit"
  | "draft_dispute"
  | "send_dispute"
  | "request_document"
  | "request_revised_statement"
  | "attach_document"
  | "confirm_revised_statement"
  | "follow_up"
  | "patient_takes_over"
  | "wait";

/** Actions that need the patient's recorded approval before they run (SPEC.md §3.3, §4.7). */
export const NEEDS_APPROVAL: ReadonlySet<ActionId> = new Set([
  "send_dispute",
  "request_document",
  "request_revised_statement",
  "follow_up",
]);

/** The facts the machine reads, assembled by the service from the stored case. */
export interface CaseSnapshot {
  /** Supported patient restrictions; absent on older snapshots. */
  preferences?: CasePreferences;
  /** At least one bill confirmed by the patient. */
  hasConfirmedBill: boolean;
  /** The audit has run at least once. */
  audited: boolean;
  findings: Finding[];
  tasks: CaseTask[];
  /** The dispute letter, once drafted. */
  dispute: { documentId: string; sent: boolean; sentAt?: IsoDate } | null;
  /** Number of counterparty responses recorded. */
  responsesRecorded: number;
  /** A revised statement was attached but not yet confirmed by the patient. */
  revisedAwaitingConfirmation: { documentId: string } | null;
  /** Approvals on record: action plus optional target (task or document ID). */
  approvals: Array<{ action: ActionId; target?: string }>;
  /** Billing entity name from the confirmed bill, for card text. */
  billingEntity: string | null;
}

/** An action the case may take now. */
export interface AllowedAction {
  id: ActionId;
  /** Button label. */
  label: string;
  needsApproval: boolean;
  /** Whether a matching approval is already on record. */
  approved: boolean;
  /** Task or document the action applies to, if any. */
  target?: string;
}

/** The "What happens next?" card (SPEC.md §3.9, §4.10). */
export interface NextAction {
  actionId: ActionId;
  title: string;
  /** Why this is next, citing findings or tasks in plain words. */
  why: string;
  /** What is needed to move forward, or `null`. */
  needed: string | null;
  /** Who acts next: "You", the billing office, a lab, … */
  responsibleParty: string;
  /** Deadline or follow-up date, "unconfirmed" when none was given, or `null` when not applicable. */
  deadline: IsoDate | "unconfirmed" | null;
  /** True if `deadline` is before today. */
  overdue: boolean;
  needsApproval: boolean;
  /** Task or document the action applies to, if any. */
  target?: string;
  /** Findings this action is about. */
  citedFindingIds: string[];
}

/** Findings still being worked on (not withdrawn, not verified). */
function open(findings: Finding[]): Finding[] {
  return findings.filter(
    (f) =>
      f.status !== "withdrawn" && !(f.status === "confirmed" && f.verified),
  );
}

/** Open tasks of a kind, oldest first. */
function openTasks(tasks: CaseTask[], kind?: CaseTask["kind"]): CaseTask[] {
  return tasks.filter((t) => t.status === "open" && (!kind || t.kind === kind));
}

/**
 * Derives the case phase from its facts (never from a stored label).
 *
 * @param s - Case snapshot.
 * @returns The phase.
 */
export function derivePhase(s: CaseSnapshot): CasePhase {
  if (!s.hasConfirmedBill) return "intake";
  if (!s.audited) return "audited";
  if (s.revisedAwaitingConfirmation) return "verifying";
  if (!open(s.findings).length) return "resolved";
  if (openTasks(s.tasks, "request_document").length) return "awaiting_approval";
  if (openTasks(s.tasks, "await_document").length) return "waiting_document";
  const unverified = s.findings.some(
    (f) => f.status === "confirmed" && !f.verified,
  );
  if (unverified) return "awaiting_approval";
  if (s.dispute && !s.dispute.sent) return "awaiting_approval";
  if (s.dispute?.sent) return "waiting_response";
  return "audited";
}

/**
 * Whether an approval for an action (and target) is on record.
 *
 * @param s - Case snapshot.
 * @param id - Action.
 * @param target - Optional task or document ID.
 * @returns True if approved.
 */
function isApproved(s: CaseSnapshot, id: ActionId, target?: string): boolean {
  return s.approvals.some(
    (a) => a.action === id && (a.target ?? undefined) === target,
  );
}

/**
 * Builds one allowed action.
 *
 * @param s - Case snapshot.
 * @param id - Action.
 * @param label - Button label.
 * @param target - Optional target.
 * @returns The action with approval flags.
 */
function action(
  s: CaseSnapshot,
  id: ActionId,
  label: string,
  target?: string,
): AllowedAction {
  const needsApproval = NEEDS_APPROVAL.has(id);
  return {
    id,
    label,
    needsApproval,
    approved: needsApproval && isApproved(s, id, target),
    ...(target ? { target } : {}),
  };
}

/**
 * Lists the actions allowed right now. Anything not listed is refused by the service.
 *
 * @param s - Case snapshot.
 * @param today - Today's date (ISO), for overdue follow-ups.
 * @returns Allowed actions, most useful first.
 */
export function allowedActions(
  s: CaseSnapshot,
  today: IsoDate,
): AllowedAction[] {
  const phase = derivePhase(s);
  if (phase === "intake")
    return [action(s, "confirm_documents", "Confirm your bill")];
  if (!s.audited) return [action(s, "run_audit", "Check the bill")];
  const out: AllowedAction[] = [];
  if (s.revisedAwaitingConfirmation) {
    out.push(
      action(
        s,
        "confirm_revised_statement",
        "Confirm the revised statement",
        s.revisedAwaitingConfirmation.documentId,
      ),
    );
  }
  const working = open(s.findings);
  if (working.length && !s.dispute)
    out.push(action(s, "draft_dispute", "Draft the dispute letter"));
  if (s.dispute && !s.dispute.sent)
    out.push(
      action(
        s,
        "send_dispute",
        "Send the dispute letter",
        s.dispute.documentId,
      ),
    );
  for (const t of openTasks(s.tasks, "request_document"))
    out.push(
      action(s, "request_document", `Request: ${t.documentNeeded}`, t.id),
    );
  const needsRevised = s.findings.some(
    (f) => f.status === "confirmed" && !f.verified,
  );
  const revisedTask = s.tasks.some(
    (t) => t.status === "open" && t.documentNeeded === REVISED_STATEMENT,
  );
  if (needsRevised && !revisedTask && !s.revisedAwaitingConfirmation) {
    out.push(
      action(s, "request_revised_statement", "Request a revised statement"),
    );
  }
  for (const t of openTasks(s.tasks, "await_document")) {
    out.push(action(s, "attach_document", `Add the ${t.documentNeeded}`, t.id));
    if (t.followUpDate && t.followUpDate < today)
      out.push(
        action(s, "follow_up", `Follow up on the ${t.documentNeeded}`, t.id),
      );
  }
  for (const t of openTasks(s.tasks))
    out.push(
      action(
        s,
        "patient_takes_over",
        `I'll handle "${t.documentNeeded}" myself`,
        t.id,
      ),
    );
  return s.preferences?.pauseContact
    ? out.filter((a) => !NEEDS_APPROVAL.has(a.id))
    : out;
}

/**
 * Checks whether an action may run now: it must be allowed, and approved if it needs approval.
 *
 * @param s - Case snapshot.
 * @param id - Action.
 * @param today - Today's date (ISO).
 * @param target - Optional task or document ID.
 * @returns `{ ok: true }` or `{ ok: false, reason }`.
 */
export function canRun(
  s: CaseSnapshot,
  id: ActionId,
  today: IsoDate,
  target?: string,
): { ok: true } | { ok: false; reason: string } {
  const a = allowedActions(s, today).find(
    (x) => x.id === id && (x.target ?? undefined) === target,
  );
  if (!a) return { ok: false, reason: `"${id}" is not allowed right now.` };
  if (a.needsApproval && !a.approved)
    return { ok: false, reason: `"${a.label}" needs your approval first.` };
  return { ok: true };
}

/**
 * Lists finding titles for card text.
 *
 * @param fs - Findings.
 * @returns e.g. "2 issues" or the single title.
 */
function describe(fs: Finding[]): string {
  return fs.length === 1 ? fs[0].title : `${fs.length} potential issues`;
}

/**
 * Chooses the "What happens next?" card: the single most useful next step, deterministically.
 *
 * Priority: confirm documents → audit → confirm a revised statement → send the drafted dispute →
 * draft it → request a missing document → follow up on an overdue promise → wait for a promised
 * document → request a revised statement → wait for the response → resolved.
 *
 * @param s - Case snapshot.
 * @param today - Today's date (ISO).
 * @returns The card.
 */
export function recommendAction(s: CaseSnapshot, today: IsoDate): NextAction {
  const office = s.billingEntity ?? "the billing office";
  const working = open(s.findings);
  const ids = working.map((f) => f.id);
  const card = (
    c: Omit<NextAction, "overdue" | "needsApproval"> & { overdue?: boolean },
  ): NextAction => ({
    overdue: false,
    ...c,
    needsApproval: NEEDS_APPROVAL.has(c.actionId),
  });

  if (!s.hasConfirmedBill) {
    return card({
      actionId: "confirm_documents",
      title: "Confirm your bill",
      why: "Nothing is checked until you confirm what the bill says.",
      needed: "Your itemized bill (and EOB if you have it)",
      responsibleParty: "You",
      deadline: null,
      citedFindingIds: [],
    });
  }
  if (!s.audited) {
    return card({
      actionId: "run_audit",
      title: "Check the bill",
      why: "Your bill is confirmed and ready to check against your EOB and records.",
      needed: null,
      responsibleParty: "You",
      deadline: null,
      citedFindingIds: [],
    });
  }
  if (s.revisedAwaitingConfirmation) {
    return card({
      actionId: "confirm_revised_statement",
      title: "Confirm the revised statement",
      why: "A revised statement arrived. Savings count only after you confirm what it says.",
      needed: "Your confirmation of the revised statement",
      responsibleParty: "You",
      deadline: null,
      target: s.revisedAwaitingConfirmation.documentId,
      citedFindingIds: ids,
    });
  }
  if (!working.length) {
    const any = s.findings.length > 0;
    return card({
      actionId: "wait",
      title: any ? "Case resolved" : "No issues found",
      why: any
        ? "Every issue is either verified on a revised statement or withdrawn with evidence."
        : "The checks found nothing to question on this bill.",
      needed: null,
      responsibleParty: "Nobody",
      deadline: null,
      citedFindingIds: [],
    });
  }
  if (s.preferences?.pauseContact) {
    return card({
      actionId: "wait",
      title: "Contact is on hold",
      why: "You asked us not to contact anyone. You can add documents, handle requests yourself, or update this choice below.",
      needed: "Your decision to resume contact",
      responsibleParty: "You",
      deadline: null,
      citedFindingIds: ids,
    });
  }
  if (s.dispute && !s.dispute.sent) {
    return card({
      actionId: "send_dispute",
      title: "Approve sending the dispute letter",
      why: `The letter asks ${office} to review ${describe(working)}. Nothing is sent without your approval.`,
      needed: "Your approval",
      responsibleParty: "You",
      deadline: null,
      target: s.dispute.documentId,
      citedFindingIds: ids,
    });
  }
  if (!s.dispute && s.responsesRecorded === 0) {
    return card({
      actionId: "draft_dispute",
      title: "Draft the dispute letter",
      why: `The audit found ${describe(working)} to ask ${office} about.`,
      needed: null,
      responsibleParty: "You",
      deadline: null,
      citedFindingIds: ids,
    });
  }
  const request = openTasks(s.tasks, "request_document")[0];
  if (request) {
    return card({
      actionId: "request_document",
      title: `Request the ${request.documentNeeded}`,
      why: `${office} said this is needed before the issue can be settled. Asking for it needs your approval.`,
      needed: request.documentNeeded,
      responsibleParty: request.responsibleParty,
      deadline: null,
      target: request.id,
      citedFindingIds: request.findingId ? [request.findingId] : ids,
    });
  }
  const waiting = openTasks(s.tasks, "await_document");
  const late = waiting.find((t) => t.followUpDate && t.followUpDate < today);
  if (late) {
    return card({
      actionId: "follow_up",
      title: `Follow up on the ${late.documentNeeded}`,
      why: `${late.responsibleParty} promised it by ${longDate(late.followUpDate as string)}, and it hasn't arrived.`,
      needed: late.documentNeeded,
      responsibleParty: late.responsibleParty,
      deadline: late.followUpDate,
      overdue: true,
      target: late.id,
      citedFindingIds: late.findingId ? [late.findingId] : ids,
    });
  }
  if (waiting.length) {
    const t = waiting[0];
    return card({
      actionId: "wait",
      title: `Waiting for the ${t.documentNeeded}`,
      why: `${t.responsibleParty} said they will send it. The case resumes when it arrives; nothing else is needed from you now.`,
      needed: t.documentNeeded,
      responsibleParty: t.responsibleParty,
      deadline: t.followUpDate ?? "unconfirmed",
      target: t.id,
      citedFindingIds: t.findingId ? [t.findingId] : ids,
    });
  }
  if (s.findings.some((f) => f.status === "confirmed" && !f.verified)) {
    return card({
      actionId: "request_revised_statement",
      title: "Request a revised statement",
      why: `${office} confirmed an error, but savings count only when a revised statement shows it.`,
      needed: "A revised statement",
      responsibleParty: office,
      deadline: null,
      citedFindingIds: ids,
    });
  }
  return card({
    actionId: "wait",
    title: `Waiting for ${office} to respond`,
    why: `The dispute letter was sent${s.dispute?.sentAt ? ` on ${longDate(s.dispute.sentAt)}` : ""}. The case updates when they answer.`,
    needed: null,
    responsibleParty: office,
    deadline: "unconfirmed",
    citedFindingIds: ids,
  });
}
