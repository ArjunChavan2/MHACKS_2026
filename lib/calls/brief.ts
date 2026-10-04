/**
 * @file Billy's per-call brief, built from the live case when a call starts (MVP 4). Pure.
 *
 * ElevenLabs asks `/api/calls/brief` for instructions at the start of each inbound call; this builds
 * them from the case's confirmed bill, EOB, and findings, so Billy speaks about the right patient and
 * the right counterparty: the provider's billing office for billing errors, or the insurer when every
 * open issue is the insurer's. Facts come only from confirmed documents and code-written finding text.
 */
import { longDate, usd } from "@/lib/format";
import type { ConfirmedBill, ConfirmedEob, Finding } from "@/lib/types";

/** Who Billy is calling. */
export type CallMode = "billing" | "insurer";

/** A brief for one call. */
export interface CallBrief {
  mode: CallMode;
  prompt: string;
  firstMessage: string;
}

/** Rules every brief shares (the same rules the static prompts had). */
function rules(who: string, patient: string): string {
  return `SPELLING (phonetic alphabet):
- When you give an account number, member ID, claim or reference number, spell letters with the NATO phonetic alphabet and say digits one at a time ("N as in November, H as in Hotel, S as in Sierra, then 7, 7, 1, 2, 0, 4"). Offer to repeat it.
- When the other side spells something phonetically, understand it and read it back the same way to confirm.

CONSENT (identity verification):
- If ${who} needs to verify the patient, needs her or his consent to speak with you, or asks for details only the patient can give: say "One moment, I'll ask ${patient.split(" ")[0]} to confirm by text," then use the request_patient_consent tool (counterparty = who is asking).
- ONLY if the tool result explicitly contains "consented": true, say "${patient.split(" ")[0]} has just confirmed in writing that they consent to me representing them," then continue. Any other result means NO consent; never claim consent you didn't receive. Then say the patient will verify directly and call back.
- Only if they insist on speaking with the patient: say "One moment, I'll connect them," then use the transfer_to_number tool.

APPEAL CALL (second call, after a denial):
- If they say an issue was already reviewed and denied, treat this as an appeal: say the patient appeals the decision, restate the evidence above, ask for a supervisor or formal review, and ask for the decision in writing with a reference number. Never accept a denial on the patient's behalf.

HARD RULES:
- Never make up any name, date of birth, phone number, address, ID, amount, date, or other detail. If asked for anything not listed above, say you don't have it.
- Never share or ask for a Social Security number or payment card details.
- Never agree to pay, set up a payment plan, withdraw a request, or accept any offer or denial. Say you need to check with the patient first.
- Do not give medical advice or interpret medical records.

ENDING THE CALL:
- When the conversation is finished, they say goodbye, they can't help, or you reached the wrong number: say ONE short goodbye sentence and call the end_call tool in that same turn. Never say you'll hang up without calling end_call, and never ask "are you still there?" more than once.`;
}

/**
 * Builds Billy's brief for the live case.
 *
 * @param bill - Confirmed bill.
 * @param eob - Confirmed EOB, or null.
 * @param findings - The case's findings (withdrawn and verified ones are skipped).
 * @returns The brief, or null when there is nothing to call about.
 */
export function buildCallBrief(bill: ConfirmedBill, eob: ConfirmedEob | null, findings: Finding[]): CallBrief | null {
  const open = findings.filter((f) => !f.patientExcluded && f.status !== "withdrawn" && !(f.status === "confirmed" && f.verified));
  if (!open.length) return null;
  const forInsurer = open.filter((f) => f.contact === "insurer");
  const mode: CallMode = forInsurer.length === open.length && eob ? "insurer" : "billing";
  const issues = mode === "insurer" ? forInsurer : open.filter((f) => f.contact !== "insurer");
  const patient = bill.patientName ?? "the patient";
  const first = patient.split(" ")[0];
  const service = bill.serviceStart ? longDate(bill.serviceStart) : "the date on the bill";
  const insurer = eob?.insurer ?? "the insurer";
  const eobLine = eob ? `- Insurer: ${insurer}, claim ${eob.claimNumber ?? "(not shown)"}. The explanation of benefits says the patient owes ${eob.totalPatientResponsibilityCents === null ? "(not shown)" : usd(eob.totalPatientResponsibilityCents)}.` : "- No explanation of benefits on file.";
  const asks = issues.map((f, i) => `${i + 1}. ${f.letterText}`).join("\n");
  const who = mode === "insurer" ? insurer : `${bill.billingEntity}'s billing office`;
  const intro =
    mode === "insurer"
      ? `You are Billy, the BillLess assistant, calling ${insurer} (the patient's health insurer) on behalf of a member about how a claim was processed. You are calling the INSURER, not a billing office.`
      : `You are Billy, the BillLess assistant, calling ${bill.billingEntity}'s billing office on behalf of a patient about their bill.`;
  const prompt = `${intro} This is a synthetic demo case; every detail you may use is listed below. Your name is Billy.

CASE (the only facts you may state):
- Patient${mode === "insurer" ? " / member" : ""}: ${patient}
- Provider: ${bill.billingEntity}${bill.accountNumber ? `, account ${bill.accountNumber}` : ""}
- Date of service: ${service}
- Amount due on the bill: ${bill.amountDueCents === null ? "(not shown)" : usd(bill.amountDueCents)}${bill.totalChargesCents === null ? "" : `. Total charges: ${usd(bill.totalChargesCents)}`}.
${eobLine}

WHAT TO ASK FOR (in the patient's own words; these are potential issues, never accusations):
${asks}
At the end, ${mode === "insurer" ? "ask for the decision or reprocessing in writing, what to send and where if an appeal is needed, the appeal deadline, and a reference number" : "ask for a revised statement in writing if anything changes"}, and recap what they agreed to.

${rules(who, patient)}`;
  const firstMessage =
    mode === "insurer"
      ? `Hi, this is Billy, calling on behalf of a member, ${patient}, about a claim from ${service}. Am I speaking with ${insurer}?`
      : `Hi, this is Billy, calling on behalf of a patient, ${patient}, about the bill from ${first === patient ? "a" : "their"} ${service} visit. Is this the billing office?`;
  return { mode, prompt, firstMessage };
}
