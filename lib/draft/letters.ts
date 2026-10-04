/**
 * @file Dispute letter and itemized-bill request drafting (SPEC.md §4.2, §4.5).
 *
 * Gemini writes structure and prose with placeholders; `placeholders.ts` fills every fact and
 * rejects drafts that invent facts. If Gemini is unavailable or its draft is rejected, a
 * deterministic template (same placeholders, same fill path) is used instead, and the draft is
 * marked `author: "template"`.
 */
import { z } from "zod";
import { generateJson, type LlmClient } from "@/lib/llm";
import type { ConfirmedBill, Draft, Finding } from "@/lib/types";
import { allowedTokens, fillContext, fillDraft, type BillContext, type FillContext } from "./placeholders";

/** Closing disclaimer on every letter (SPEC.md §4.5). */
export const DISCLAIMER =
  "This letter was prepared with help from an app. It is plain-language help, not legal or financial advice; rules vary by state and by plan.";

/** Shape of the model's draft. */
const DraftReplySchema = z.object({ subject: z.string().min(1), paragraphs: z.array(z.string().min(1)).min(2) });

/** JSON Schema for the model's draft. */
const DRAFT_JSON_SCHEMA = {
  type: "object",
  properties: { subject: { type: "string" }, paragraphs: { type: "array", items: { type: "string" } } },
  required: ["subject", "paragraphs"],
};

/** System instruction for letter drafting. */
const DRAFT_SYSTEM = [
  "You draft short, polite, firm letters from a patient to a hospital billing office.",
  "You may ONLY state facts through the placeholders you are given. Never write a dollar amount, date,",
  "billing code, account number, or name yourself; use the matching placeholder.",
  "Describe issues as potential issues to be checked, never as proven errors or accusations.",
  "Do not give medical advice, threaten, or promise anything on the patient's behalf.",
].join(" ");

/**
 * Deterministic dispute-letter template using the same placeholders as the model.
 *
 * @param findings - Findings to include, in order.
 * @returns Subject and paragraphs with placeholders.
 */
export function disputeTemplate(findings: Finding[]): { subject: string; paragraphs: string[] } {
  return {
    subject: "Request for review of account {{account_number}}",
    paragraphs: [
      "To the billing office at {{provider}}:",
      "I am writing about the bill for {{patient_name}}, account {{account_number}}, for services on {{service_dates}}, with {{amount_due}} shown as due. Before I pay, I would like you to review the items below.",
      ...findings.map((f) => `{{finding:${f.id}:title}}. {{finding:${f.id}:explanation}} {{finding:${f.id}:ask}}`),
      "Please send me a written response and, if any charges change, a revised statement. I am not refusing to pay amounts I owe; I am asking you to confirm these items first.",
      "Thank you,\n{{patient_name}}",
    ],
  };
}

/**
 * Drafts the dispute letter for the confirmed bill and its findings.
 *
 * Side effects: one or two model calls when Gemini is available.
 *
 * @param bill - Confirmed bill.
 * @param findings - Rule-produced findings (must be non-empty for a dispute).
 * @param client - Model client; omit to use Gemini, or pass `null` to force the template.
 * @returns The filled draft with sources per paragraph and the disclaimer appended.
 */
export async function draftDisputeLetter(bill: ConfirmedBill, findings: Finding[], client?: LlmClient | null): Promise<Draft> {
  const ctx = fillContext(bill, findings);
  if (client !== null) {
    try {
      const { value } = await generateJson(
        {
          system: DRAFT_SYSTEM,
          prompt: [
            "Write a dispute letter covering every finding below. Mention each finding at least once.",
            `Allowed placeholders: ${allowedTokens(ctx).join(", ")}`,
            "Findings (for your understanding only; refer to them only via placeholders):",
            ...findings.map((f) => `- ${f.id}: ${f.rule}`),
            "End with a request for a written response and a revised statement if anything changes.",
          ].join("\n"),
          jsonSchema: DRAFT_JSON_SCHEMA,
          validator: DraftReplySchema,
          temperature: 0.3,
        },
        client,
      );
      return finish("dispute_letter", value.subject, value.paragraphs, ctx, "llm");
    } catch {
      // LLM unavailable, invalid twice, or draft rejected by the placeholder guard:
      // fall through to the deterministic template, which uses the same fill path.
    }
  }
  const t = disputeTemplate(findings);
  return finish("dispute_letter", t.subject, t.paragraphs, ctx, "template");
}

/**
 * Drafts an itemized-bill request for a balance statement (deterministic template only).
 *
 * @param bill - Header values the patient confirmed on the balance statement.
 * @returns The filled request with the disclaimer.
 */
export function draftItemizedBillRequest(bill: BillContext): Draft {
  const ctx = fillContext(bill, []);
  return finish(
    "itemized_bill_request",
    "Request for an itemized bill, account {{account_number}}",
    [
      "To the billing office at {{provider}}:",
      "I received a statement for {{patient_name}}, account {{account_number}}, showing {{amount_due}} due. Please send me a fully itemized bill listing each service with its date, billing code, quantity, and charge, along with any adjustments and payments applied.",
      "Please also tell me which insurance claim this balance relates to so I can compare it with my explanation of benefits.",
      "Thank you,\n{{patient_name}}",
    ],
    ctx,
    "template",
  );
}

/**
 * Fills a draft and appends the disclaimer.
 *
 * @param kind - Draft kind.
 * @param subject - Subject with placeholders.
 * @param paragraphs - Paragraphs with placeholders.
 * @param ctx - Fill context.
 * @param author - Who wrote the prose.
 * @returns The finished draft.
 * @throws {DraftRejectedError} When the draft breaks the placeholder rules.
 */
function finish(kind: Draft["kind"], subject: string, paragraphs: string[], ctx: FillContext, author: Draft["author"]): Draft {
  const filled = fillDraft(subject, paragraphs, ctx);
  return { kind, subject: filled.subject, paragraphs: [...filled.paragraphs, { text: DISCLAIMER, sources: [] }], author };
}
