/** @file Serializable patient call workspace contract; contains no provider credentials or clinical interpretation. */
import { z } from "zod";
import type { CallRecord, CallTurn } from "./history";

/** Explicit pre-call choices; recipient numbers and takeover numbers must be E.164. */
export const CallReviewSchema = z
  .object({
    recipient: z.string().trim().min(1).max(150),
    phone: z.string().regex(/^\+\d{10,15}$/),
    patientPhone: z.string().regex(/^\+\d{10,15}$/),
    purpose: z.string().trim().min(1).max(500),
    disclosures: z
      .array(z.enum(["account", "findings"]))
      .min(1)
      .max(2),
  })
  .strict();

/** Choices authored and approved by the patient for this call only. */
export type CallReview = z.infer<typeof CallReviewSchema>;

/** Patient outcome notes reference original turns rather than an AI summary; no payment or savings changes. */
export const CallOutcomeSchema = z
  .object({
    sessionId: z.string().min(1),
    turnIndexes: z.array(z.number().int().nonnegative()).max(50),
    nextStep: z.enum([
      "request_written_proof",
      "follow_up",
      "human_review",
      "no_follow_up",
    ]),
    dueDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullable(),
    note: z.string().trim().max(1000),
  })
  .strict();

/** Saved patient-authored outcome and verbatim references; a due date proposes a reminder, never contact. */
export type CallOutcome = z.infer<typeof CallOutcomeSchema>;

/** A bounded administrative choice reported by the voice agent; silence never authorizes an agreement. */
export interface CallDecision {
  id: string;
  statement: string;
  expiresAt: string;
  resolution: "ask_written" | "decline" | "takeover" | null;
}

/** One immutable approved review plus observable call state, held as case event snapshots. */
export interface CallSession {
  id: string;
  mode: "live" | "rehearsal";
  review: CallReview;
  disclosures: Array<{ key: "account" | "findings"; text: string }>;
  preferenceVersion: string;
  status:
    | "prepared"
    | "starting"
    | "queued"
    | "ringing"
    | "in-progress"
    | "completed"
    | "busy"
    | "failed"
    | "no-answer"
    | "canceled"
    | "handed_back"
    | "transfer_requested";
  createdAt: string;
  sid: string | null;
  conversationId: string | null;
  transcript: CallTurn[];
  record: CallRecord | null;
  error: string | null;
  outcome: CallOutcome | null;
  rehearsalStep: number;
  decision: CallDecision | null;
}

/** Server-prepared eligible disclosure choices and all session history for the current case. */
export interface CallWorkspaceView {
  available: boolean;
  unavailableReason: string | null;
  disclosures: Array<{ key: "account" | "findings"; text: string }>;
  sessions: CallSession[];
}

/** Finished states where no additional live action may run. */
export const FINISHED_CALL_STATES = new Set<CallSession["status"]>([
  "completed",
  "busy",
  "failed",
  "no-answer",
  "canceled",
  "handed_back",
]);
