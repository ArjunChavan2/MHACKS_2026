/** @file Plain-text email composition from the patient's saved letter; never sends mail. */
import type { Draft } from "@/lib/types";

/** Returns the saved letter text in order, including its disclaimer and patient wording. */
export function emailBody(draft: Draft): string {
  return draft.paragraphs.map((paragraph) => paragraph.text).join("\n\n");
}

/** Copies a complete email with an optional recipient, subject, and body. */
export function emailText(draft: Draft, recipientEmail: string): string {
  return `${recipientEmail ? `To: ${recipientEmail}\n` : ""}Subject: ${draft.subject}\n\n${emailBody(draft)}`;
}

/** Encodes the recipient, subject and body as separate URI components for the patient's mail app. */
export function emailHref(draft: Draft, recipientEmail: string): string {
  return `mailto:${encodeURIComponent(recipientEmail)}?subject=${encodeURIComponent(draft.subject)}&body=${encodeURIComponent(emailBody(draft))}`;
}
