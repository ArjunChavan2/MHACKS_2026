"use client";
/** @file Explicit goal and supported constraint controls (SPEC.md §3.1); no inferred approvals. */
import type { CasePreferencesInput } from "@/lib/cases/preferences";

/**
 * Edits patient choices, with persistence owned by the enclosing intake or case screen.
 * @param props - Controlled choices, busy state and edit callback.
 * @returns Labeled accessible fields; changes alone never authorize contact or payment.
 */
export default function CasePreferencesPanel({
  value,
  disabled,
  onChange,
}: {
  /** Patient-authored administrative goal and supported restrictions. */
  value: CasePreferencesInput;
  /** Prevents edits while the parent is saving or processing. */
  disabled: boolean;
  /** Updates local choices; the parent must save them explicitly. */
  onChange: (value: CasePreferencesInput) => void;
}) {
  return (
    <fieldset
      className="paper-flow billless-preferences-panel"
      disabled={disabled}
    >
      <legend className="paper-eyebrow">YOUR GOAL AND CHOICES</legend>
      <label className="billless-goal-label">
        What would you like help with?
        <textarea
          rows={2}
          maxLength={500}
          value={value.goal}
          onChange={(e) => onChange({ ...value, goal: e.target.value })}
        />
      </label>
      <label className="billless-choice-label">
        <input
          type="checkbox"
          checked={value.noPayments}
          onChange={(e) => onChange({ ...value, noPayments: e.target.checked })}
        />
        Don’t agree to any payments
      </label>
      <label className="billless-choice-label">
        <input
          type="checkbox"
          checked={value.pauseContact}
          onChange={(e) =>
            onChange({ ...value, pauseContact: e.target.checked })
          }
        />
        Hold contact — I’ll handle communication myself
      </label>
      <p className="paper-copy">
        We save these choices with your case. Every contact still needs your
        approval. Payment agreements aren’t available in this demo.
      </p>
    </fieldset>
  );
}
