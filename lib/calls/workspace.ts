/** @file Approved patient call lifecycle. Exact disclosure snapshots, fail-closed live configuration and labeled rehearsal. */
import { getStore, newId, type StoredCase } from "@/lib/cases/store";
import { preferencesOf } from "@/lib/cases/preferences";
import { BadRequestError } from "@/lib/cases/service";
import type { ConfirmedBill } from "@/lib/types";
import {
  agentConfig,
  callConfig,
  controlCall,
  getCallStatus,
  placeAgentCall,
} from "./index";
import type { CallDecision } from "./workspace-types";
import { conversationForCall } from "./history";
import {
  CallOutcomeSchema,
  CallReviewSchema,
  FINISHED_CALL_STATES,
  type CallOutcome,
  type CallReview,
  type CallSession,
  type CallWorkspaceView,
} from "./workspace-types";

/** In-process serialization prevents polling/control/double-click races for one case in the demo runtime. */
const locks = new Map<string, Promise<unknown>>();

/** Serializes workspace writes for a case; errors still release the lock. Multi-instance deployments need a database lock. */
async function exclusive<T>(
  caseId: string,
  work: () => Promise<T>,
): Promise<T> {
  const previous = locks.get(caseId) ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(work);
  locks.set(caseId, current);
  try {
    return await current;
  } finally {
    if (locks.get(caseId) === current) locks.delete(caseId);
  }
}

/** Requires an existing case before any read/write/provider request. */
async function requireCase(id: string): Promise<StoredCase> {
  const c = await getStore().getCase(id);
  if (!c) throw new BadRequestError("Unknown case");
  return c;
}

/** Reads the latest full snapshot for each session, preserving creation order and historical outcomes. */
export function callSessionsOf(c: StoredCase): CallSession[] {
  const sessions = new Map<string, CallSession>();
  for (const event of c.events.filter(
    (e) => e.type === "call_session_updated",
  )) {
    const session = event.data as CallSession;
    sessions.set(session.id, session);
  }
  for (const event of c.events.filter((e) => e.type === "call_recorded")) {
    const record = event.data as import("./history").CallRecord;
    if (
      [...sessions.values()].some(
        (s) => s.conversationId === record.conversationId,
      )
    )
      continue;
    const id = `history_${record.conversationId}`;
    if (sessions.has(id)) continue;
    sessions.set(id, {
      id,
      mode: "live",
      review: {
        recipient: "Saved call · recipient not recorded",
        phone: "",
        patientPhone: "",
        purpose: "Review saved provider transcript",
        disclosures: [],
      },
      disclosures: [],
      preferenceVersion: "",
      status: "completed",
      createdAt: record.startedAt,
      sid: null,
      conversationId: record.conversationId,
      transcript: record.transcript,
      record,
      error: null,
      outcome: null,
      rehearsalStep: 0,
      decision: null,
    });
  }
  return [...sessions.values()].sort((a, b) =>
    a.createdAt.localeCompare(b.createdAt),
  );
}

/** Builds exact administrative disclosure choices only from confirmed bills and deterministic findings. */
function disclosureChoices(c: StoredCase): CallWorkspaceView["disclosures"] {
  const bill = c.documents.find(
    (d) =>
      d.direction === "incoming" &&
      d.docType === "itemized_bill" &&
      d.confirmed,
  )?.confirmed as ConfirmedBill | undefined;
  const choices: CallWorkspaceView["disclosures"] = [];
  if (bill)
    choices.push({
      key: "account",
      text: `Patient: ${bill.patientName ?? "not recorded"}; provider: ${bill.billingEntity ?? "not recorded"}; account: ${bill.accountNumber ?? "not recorded"}. Source: confirmed document ${bill.documentId}.`,
    });
  if (c.findings.length)
    choices.push({
      key: "findings",
      text: c.findings
        .map(
          (f) =>
            `${f.title}: ${f.explanation} [${f.status}; rule ${f.rule}; finding ${f.id}]`,
        )
        .join("\n"),
    });
  return choices;
}

/** Returns a safe configuration explanation. Live calls require explicit deployment of the scoped agent contract. */
function availability(): {
  available: boolean;
  unavailableReason: string | null;
} {
  if (process.env.CALL_WORKSPACE_ENABLED !== "true")
    return {
      available: false,
      unavailableReason:
        "Live outbound calling is not enabled for this deployment. You can review a call plan or try a synthetic rehearsal. The agent must support the approved briefing before live calling is enabled.",
    };
  try {
    callConfig();
    agentConfig();
    if (!process.env.MESSAGING_SECRET)
      throw new Error("Missing agent tool secret");
    return { available: true, unavailableReason: null };
  } catch {
    return {
      available: false,
      unavailableReason:
        "Live calling needs completed provider configuration. No call will be placed.",
    };
  }
}

/** Saves a full snapshot; bookkeeping stays off the patient timeline. */
async function save(caseId: string, session: CallSession): Promise<void> {
  await getStore().addEvent(caseId, "call_session_updated", session);
}

/** Prevents stale approval, paused contact or unconfirmed scope from authorizing a real call. */
function assertApprovalCurrent(c: StoredCase, session: CallSession): void {
  const prefs = preferencesOf(c);
  if (
    prefs.pauseContact ||
    !prefs.version ||
    prefs.version !== session.preferenceVersion
  )
    throw new BadRequestError(
      "Your contact choices changed. Review and approve a new call plan.",
    );
  const current = disclosureChoices(c);
  if (
    session.disclosures.some(
      (d) =>
        !current.some(
          (choice) => choice.key === d.key && choice.text === d.text,
        ),
    )
  )
    throw new BadRequestError(
      "The case evidence changed. Review and approve a new call plan.",
    );
}

/** Retrieves the case-bound session; arbitrary provider IDs are never accepted from the patient browser. */
function requireSession(c: StoredCase, id: string): CallSession {
  const session = callSessionsOf(c).find((s) => s.id === id);
  if (!session) throw new BadRequestError("Unknown call session on this case");
  return session;
}

/** Returns workspace history and configuration without placing or controlling any call. */
export async function loadCallWorkspace(
  caseId: string,
): Promise<CallWorkspaceView> {
  const c = await requireCase(caseId);
  return {
    ...availability(),
    disclosures: disclosureChoices(c),
    sessions: callSessionsOf(c),
  };
}

/** Records explicit approval for exact recipient, scope and current preference version. No contact occurs. */
export async function prepareCall(
  caseId: string,
  input: CallReview,
  mode: "live" | "rehearsal",
): Promise<CallSession> {
  return exclusive(caseId, async () => {
    const c = await requireCase(caseId);
    const review = CallReviewSchema.parse(input);
    const prefs = preferencesOf(c);
    if (prefs.pauseContact || !prefs.version)
      throw new BadRequestError(
        "Save your case goal and clear the contact hold before approving a call.",
      );
    if (
      callSessionsOf(c).some(
        (s) => !FINISHED_CALL_STATES.has(s.status) && s.status !== "prepared",
      )
    )
      throw new BadRequestError(
        "Finish or end the current call before preparing another.",
      );
    const choices = disclosureChoices(c);
    const disclosures = [...new Set(review.disclosures)].map((key) =>
      choices.find((d) => d.key === key),
    );
    if (disclosures.some((d) => !d))
      throw new BadRequestError(
        "The selected disclosure is not available from confirmed case evidence.",
      );
    const session: CallSession = {
      id: newId("call"),
      mode,
      review,
      disclosures: disclosures as CallSession["disclosures"],
      preferenceVersion: prefs.version,
      status: "prepared",
      createdAt: new Date().toISOString(),
      sid: null,
      conversationId: null,
      transcript: [],
      record: null,
      error: null,
      outcome: null,
      rehearsalStep: 0,
      decision: null,
    };
    await save(caseId, session);
    await getStore().addEvent(caseId, "call_review_approved", {
      sessionId: session.id,
      mode,
      recipient: review.recipient,
    });
    return session;
  });
}

/** Starts only the latest approved plan once. Provider uncertainty is recorded and cannot be blindly retried. */
export async function startCall(
  caseId: string,
  sessionId: string,
): Promise<CallSession> {
  return exclusive(caseId, async () => {
    const c = await requireCase(caseId);
    const session = requireSession(c, sessionId);
    if (
      callSessionsOf(c).at(-1)?.id !== sessionId ||
      session.status !== "prepared"
    )
      throw new BadRequestError(
        "This call plan has already been used or replaced. Review a new plan.",
      );
    assertApprovalCurrent(c, session);
    if (session.mode === "live" && !availability().available)
      throw new BadRequestError(availability().unavailableReason!);
    session.status = "starting";
    await save(caseId, session);
    try {
      if (session.mode === "rehearsal") {
        session.status = "in-progress";
        session.transcript = [
          {
            role: "agent",
            message:
              "Synthetic rehearsal: calling to request written billing information. No real office is on this call.",
            atSecs: 0,
          },
        ];
      } else {
        const call = await placeAgentCall(session.review.phone, {
          case_id: caseId,
          call_session_id: session.id,
        });
        session.sid = call.sid;
        session.status = call.status as CallSession["status"];
      }
    } catch {
      session.status = "failed";
      session.error =
        "The provider did not confirm that the call was placed. Check provider call history before retrying; a timeout may still have created a call.";
    }
    await save(caseId, session);
    return session;
  });
}

/** Produces the exact approved agent brief for a signed Twilio callback; stale approvals close the call. */
export async function approvedCallVariables(
  caseId: string,
  sessionId: string,
): Promise<Record<string, string>> {
  const c = await requireCase(caseId);
  const session = requireSession(c, sessionId);
  assertApprovalCurrent(c, session);
  if (
    session.mode !== "live" ||
    !["starting", "queued", "ringing", "in-progress"].includes(
      session.status,
    ) ||
    !availability().available
  )
    throw new BadRequestError("Call approval is not active.");
  return {
    case_id: caseId,
    call_session_id: session.id,
    approved_brief: `${session.review.purpose}\n${session.disclosures.map((d) => d.text).join("\n")}\nRestrictions: disclose only these exact approved facts. Never make a payment, accept any offer or condition, agree to a plan, or expand disclosure. Ask for written information and hand back to the patient for decisions.`,
    patient_phone: session.review.patientPhone,
  };
}

/** Polls one exact case-owned provider call. Missing transcript data stays visibly pending; errors do not look completed. */
export async function refreshCall(
  caseId: string,
  sessionId: string,
): Promise<CallSession> {
  return exclusive(caseId, async () => {
    const c = await requireCase(caseId);
    const session = requireSession(c, sessionId);
    if (session.mode === "rehearsal" || !session.sid || session.record)
      return session;
    try {
      const call = await getCallStatus(session.sid);
      session.status =
        session.status === "transfer_requested" && call.status === "in-progress"
          ? "transfer_requested"
          : (call.status as CallSession["status"]);
      const prefs = preferencesOf(c);
      if (
        !FINISHED_CALL_STATES.has(session.status) &&
        (prefs.pauseContact || prefs.version !== session.preferenceVersion)
      ) {
        await controlCall(session.sid);
        session.status = "completed";
        session.error =
          "The assistant call was ended because your contact preferences changed.";
      }
      const conversation = await conversationForCall(
        session.sid,
        session.conversationId,
      );
      if (conversation) {
        session.conversationId = conversation.conversationId;
        session.transcript = conversation.transcript;
        session.record = conversation.record;
      }
      if (!session.error?.includes("contact preferences changed"))
        session.error = null;
      if (
        session.record &&
        !c.events.some(
          (e) =>
            e.type === "call_recorded" &&
            (e.data as { conversationId: string }).conversationId ===
              session.record!.conversationId,
        )
      )
        await getStore().addEvent(caseId, "call_recorded", session.record);
    } catch {
      session.error =
        "Call status or transcript could not be refreshed. The call may still be active. Try refresh or use your phone to contact the office.";
    }
    await save(caseId, session);
    return session;
  });
}

/** Explicit end/takeover controls remain available even when approvals expire. Rehearsal never calls providers. */
export async function changeCall(
  caseId: string,
  sessionId: string,
  action: "end" | "takeover" | "rehearsal_next",
): Promise<CallSession> {
  return exclusive(caseId, async () => {
    const c = await requireCase(caseId);
    const session = requireSession(c, sessionId);
    if (FINISHED_CALL_STATES.has(session.status))
      throw new BadRequestError("This call has ended.");
    if (action === "rehearsal_next") {
      if (session.mode !== "rehearsal" || session.status !== "in-progress")
        throw new BadRequestError("Only an active rehearsal can advance.");
      session.rehearsalStep++;
      session.transcript.push(
        session.rehearsalStep === 1
          ? {
              role: "user",
              message:
                "Synthetic office: we can review a reduction, but it is not in writing yet.",
              atSecs: 12,
            }
          : {
              role: "agent",
              message:
                "Please provide written confirmation. The patient has not agreed to any offer or condition.",
              atSecs: 24,
            },
      );
      if (session.rehearsalStep === 1)
        session.decision = {
          id: newId("decision"),
          statement: session.transcript.at(-1)!.message,
          expiresAt: new Date(Date.now() + 40000).toISOString(),
          resolution: null,
        };
      if (session.rehearsalStep >= 2) {
        session.status = "completed";
        session.record = {
          conversationId: session.id,
          startedAt: session.createdAt,
          durationSecs: 25,
          endedBy: "Synthetic rehearsal completed",
          transcript: session.transcript,
        };
      }
    } else if (session.mode === "rehearsal" || session.status === "prepared")
      session.status = action === "takeover" ? "handed_back" : "canceled";
    else if (session.sid) {
      try {
        const controlled = await controlCall(
          session.sid,
          action === "takeover" ? session.review.patientPhone : undefined,
        );
        session.status =
          action === "takeover"
            ? "transfer_requested"
            : (controlled.status as CallSession["status"]);
        session.error = null;
      } catch {
        session.error =
          "The provider did not confirm this control. The call may still be active. Use End call again or call the office yourself; takeover has not been confirmed.";
      }
    } else
      throw new BadRequestError(
        "No provider call reference is available. Check provider call history before trying again.",
      );
    await save(caseId, session);
    return session;
  });
}

/** Saves patient-selected original transcript turns and a proposed follow-up; verbal offers never count as verified savings. */
export async function saveCallOutcome(
  caseId: string,
  input: CallOutcome,
): Promise<CallSession> {
  return exclusive(caseId, async () => {
    const outcome = CallOutcomeSchema.parse(input);
    const c = await requireCase(caseId);
    const session = requireSession(c, outcome.sessionId);
    if (!FINISHED_CALL_STATES.has(session.status))
      throw new BadRequestError("Review the outcome after the call ends.");
    if (outcome.turnIndexes.some((index) => !session.transcript[index]))
      throw new BadRequestError(
        "An outcome reference is not in this call transcript.",
      );
    if (
      outcome.dueDate &&
      (Number.isNaN(Date.parse(outcome.dueDate)) ||
        new Date(outcome.dueDate).toISOString().slice(0, 10) !==
          outcome.dueDate)
    )
      throw new BadRequestError("Choose a valid follow-up date.");
    session.outcome = outcome;
    await save(caseId, session);
    await getStore().addEvent(caseId, "call_outcome_reviewed", {
      sessionId: session.id,
      nextStep: outcome.nextStep,
      dueDate: outcome.dueDate,
      note: outcome.note,
    });
    return session;
  });
}

/** Opens one bounded offer review on an approved live session; never authorizes additional disclosures or payments. */
export async function requestCallDecision(
  caseId: string,
  sessionId: string,
  statement: string,
): Promise<CallDecision> {
  return exclusive(caseId, async () => {
    const c = await requireCase(caseId);
    const session = requireSession(c, sessionId);
    assertApprovalCurrent(c, session);
    if (session.mode !== "live" || session.status !== "in-progress")
      throw new BadRequestError("No active approved call.");
    if (
      session.decision &&
      !session.decision.resolution &&
      Date.parse(session.decision.expiresAt) > Date.now()
    )
      throw new BadRequestError("A patient decision is already pending.");
    const decision: CallDecision = {
      id: newId("decision"),
      statement,
      expiresAt: new Date(Date.now() + 40000).toISOString(),
      resolution: null,
    };
    session.decision = decision;
    await save(caseId, session);
    return decision;
  });
}

/** Saves an explicit choice for the matching open request; an expired window always becomes a decline. */
export async function answerCallDecision(
  caseId: string,
  sessionId: string,
  decisionId: string,
  resolution: NonNullable<CallDecision["resolution"]>,
): Promise<CallSession> {
  return exclusive(caseId, async () => {
    const c = await requireCase(caseId);
    const session = requireSession(c, sessionId);
    if (
      !session.decision ||
      session.decision.id !== decisionId ||
      session.decision.resolution ||
      FINISHED_CALL_STATES.has(session.status)
    )
      throw new BadRequestError("This decision is no longer pending.");
    session.decision.resolution =
      Date.parse(session.decision.expiresAt) <= Date.now()
        ? "decline"
        : resolution;
    await save(caseId, session);
    return session;
  });
}

/** Waits for the exact request's answer for at most forty seconds; timeout, ended call or changed constraints means decline. */
export async function waitCallDecision(
  caseId: string,
  sessionId: string,
  decisionId: string,
): Promise<NonNullable<CallDecision["resolution"]>> {
  const deadline = Date.now() + 40000;
  for (;;) {
    const c = await requireCase(caseId);
    const session = requireSession(c, sessionId);
    if (
      !session.decision ||
      session.decision.id !== decisionId ||
      FINISHED_CALL_STATES.has(session.status)
    )
      return "decline";
    try {
      assertApprovalCurrent(c, session);
    } catch {
      return "decline";
    }
    if (session.decision.resolution) return session.decision.resolution;
    if (
      Date.now() >= Math.min(deadline, Date.parse(session.decision.expiresAt))
    ) {
      await answerCallDecision(caseId, sessionId, decisionId, "decline");
      return "decline";
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}
