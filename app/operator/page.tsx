/**
 * @file /operator: the simulated billing-office console for the MVP 2 demo (SPEC.md §6 MVP 2).
 * A teammate plays the billing office here; the patient's case screen never links to it.
 */
import type { Metadata } from "next";
import OperatorConsole from "../_components/OperatorConsole";

/** Page metadata. */
export const metadata: Metadata = { title: "Simulated billing office" };

/**
 * Operator page.
 *
 * @returns The operator console.
 */
export default function OperatorPage() {
  return <OperatorConsole />;
}
