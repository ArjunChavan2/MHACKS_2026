/**
 * @file Patient-authored case goals and supported constraints (SPEC.md §2.5, §3.1).
 * Shared schema only: no I/O, medical interpretation, or inferred consent.
 */
import { z } from "zod";
import type { StoredCase } from "./store";

/** Validated preferences a patient can explicitly save; unknown fields are refused. */
export const CasePreferencesSchema = z
  .object({
    /** Administrative goal, stored verbatim; never interpreted as a finding. */
    goal: z.string().trim().min(1).max(500),
    /** Restricts the case from making payment commitments. Current actions never make payments. */
    noPayments: z.boolean(),
    /** Holds all automated contact, including simulated sends, until the patient clears it. */
    pauseContact: z.boolean(),
  })
  .strict();

/** Explicit supported choices accepted by the preferences endpoint. */
export type CasePreferencesInput = z.infer<typeof CasePreferencesSchema>;

/** Stored preferences; null fields mean the patient has not yet saved a choice. */
export interface CasePreferences {
  /** Patient's own administrative goal, or no recorded goal. */
  goal: string | null;
  /** Explicit no-payment restriction; false never authorizes a payment. */
  noPayments: boolean;
  /** Whether case contact actions must be held. */
  pauseContact: boolean;
  /** Unique change ID used to invalidate older approval prompts. */
  version: string | null;
}

/**
 * Reads the latest validated preferences event, with conservative legacy defaults.
 * Pure: never modifies the case or interprets the goal.
 * @param c - Stored case and its ordered events.
 * @returns Latest choices, or the old nullable goal with no explicit choices.
 */
export function preferencesOf(c: StoredCase): CasePreferences {
  const data = c.events
    .filter((e) => e.type === "case_preferences_updated")
    .at(-1)?.data;
  const parsed = CasePreferencesSchema.extend({
    version: z.string().min(1),
  }).safeParse(data);
  return parsed.success
    ? parsed.data
    : { goal: c.goal, noPayments: false, pauseContact: false, version: null };
}
