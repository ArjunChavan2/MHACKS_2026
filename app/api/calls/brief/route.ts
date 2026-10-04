/**
 * @file POST /api/calls/brief: ElevenLabs' "conversation initiation" webhook for inbound calls.
 *
 * At the start of each call, returns Billy's instructions and first line built from the live case
 * (`caseForLiveCall`: the case whose screen last pressed "Get Billy ready"), so Billy speaks about the right patient and calls the right counterparty
 * (billing office vs insurer). The insurer-denial agent keeps its own fixed brief. Authenticated with
 * the `x-billy-secret` header (= MESSAGING_SECRET), set in ElevenLabs' workspace webhook settings.
 */
import { timingSafeEqual } from "node:crypto";
import { approvedCallVariables, callSessionsOf } from "@/lib/calls/workspace";
import { buildCallBrief } from "@/lib/calls/brief";
import { caseForLiveCall } from "@/lib/cases/consent";
import { getStore } from "@/lib/cases/store";
import type { ConfirmedBill, ConfirmedEob } from "@/lib/types";

/**
 * Constant-time check of the shared secret.
 *
 * @param given - Header value.
 * @returns True when it matches `MESSAGING_SECRET`.
 */
function authorized(given: string | null): boolean {
  const secret = process.env.MESSAGING_SECRET;
  if (!secret || !given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Brief used when the live case has nothing to call about yet (never another patient's case). */
const NO_CASE = {
  prompt:
    "You are Billy, the BillLess assistant. You don't have a patient case loaded for this call. Politely say you're calling on behalf of a patient but don't have their details in front of you, and that the patient will call back. Never make up any name, number, amount, or detail. Then say one short goodbye sentence and call the end_call tool in the same turn.",
  first_message:
    "Hi, this is Billy from BillLess. I'm sorry, I don't have the patient's details in front of me right now.",
};

/**
 * Returns the conversation-initiation data for this call.
 *
 * @param req - ElevenLabs request with `{ caller_id, agent_id, called_number, call_sid }`.
 * @returns `{ type, dynamic_variables, conversation_config_override? }`.
 */
export async function POST(req: Request): Promise<Response> {
  if (!authorized(req.headers.get("x-billy-secret")))
    return Response.json({ error: "unauthorized" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as {
    agent_id?: string;
    call_sid?: string;
  };
  const base = {
    type: "conversation_initiation_client_data",
    dynamic_variables: {} as Record<string, string>,
  };
  // Enabled outbound workspaces must resolve the exact approved call, never the latest case.
  if (process.env.CALL_WORKSPACE_ENABLED === "true") {
    let variables: Record<string, string> | null = null;
    if (body.call_sid && /^CA[a-fA-F0-9]{32}$/.test(body.call_sid)) {
      const ids = await getStore().findCasesByEvent("call_session_updated", {
        sid: body.call_sid,
      });
      for (const id of ids) {
        const stored = await getStore().getCase(id);
        const session =
          stored && callSessionsOf(stored).find((s) => s.sid === body.call_sid);
        if (!session) continue;
        try {
          variables = await approvedCallVariables(id, session.id);
        } catch {
          variables = null;
        }
        break;
      }
    }
    const agent = variables
      ? {
          prompt: {
            prompt: `You are Billy. Use only this patient-approved scope:\n${variables.approved_brief}\nTool caseId: ${variables.case_id}; sessionId: ${variables.call_session_id}. Request representation consent through request_patient_consent; only the patient's matching iMessage authorizes it. For office proposals use request_patient_decision; never authorize agreements. Transfer only on patient request to patient_phone. Otherwise end_call.`,
          },
          first_message:
            "Hello, this is Billy calling on behalf of a patient to request written information.",
        }
      : {
          prompt: { prompt: NO_CASE.prompt },
          first_message: NO_CASE.first_message,
        };
    return Response.json({
      ...base,
      dynamic_variables: variables ?? {},
      conversation_config_override: { agent },
    });
  }
  // The prior-authorization denial agent has its own fixed brief.
  if (
    body.agent_id &&
    body.agent_id === process.env.ELEVENLABS_INSURER_AGENT_ID
  )
    return Response.json(base);
  const caseId = await caseForLiveCall();
  const c = caseId ? await getStore().getCase(caseId) : null;
  const billDoc = c?.documents.find(
    (d) =>
      d.direction === "incoming" &&
      d.docType === "itemized_bill" &&
      d.confirmed,
  );
  const eobDoc = c?.documents.find(
    (d) => d.direction === "incoming" && d.docType === "eob" && d.confirmed,
  );
  const brief =
    c && billDoc
      ? buildCallBrief(
          billDoc.confirmed as ConfirmedBill,
          (eobDoc?.confirmed as ConfirmedEob | undefined) ?? null,
          c.findings,
        )
      : null;
  const agent = brief
    ? { prompt: { prompt: brief.prompt }, first_message: brief.firstMessage }
    : {
        prompt: { prompt: NO_CASE.prompt },
        first_message: NO_CASE.first_message,
      };
  if (caseId)
    await getStore().addEvent(caseId, "call_briefed", {
      mode: brief?.mode ?? "none",
    });
  return Response.json({ ...base, conversation_config_override: { agent } });
}
