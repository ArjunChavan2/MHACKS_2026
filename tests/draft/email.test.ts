/** @file Proves email handoff preserves the saved letter and safely encodes mailto query fields. */
import { describe, expect, it } from "vitest";
import { emailBody, emailHref, emailText } from "@/lib/draft/email";
import type { Draft } from "@/lib/types";

/** Synthetic wording exercises punctuation, Unicode, newlines and saved patient edits. */
const draft: Draft = { kind: "dispute_letter", subject: "Review A&B? #42", author: "template", paragraphs: [{ text: "Hello billing team,", sources: [] }, { text: "Please review €68 & reply.\nThank you.", sources: [], patientProvided: true }, { text: "Sample disclaimer", sources: [] }] };

describe("email handoff", () => {
  /** All saved paragraphs, including patient wording and disclaimer, survive copying and URI encoding. */
  it("preserves subject and full letter in a prefilled email", () => {
    const recipient = "billing+review@example.test";
    const href = new URL(emailHref(draft, recipient));
    expect(decodeURIComponent(href.pathname)).toBe(recipient);
    expect(href.searchParams.get("subject")).toBe(draft.subject);
    expect(href.searchParams.get("body")).toBe(emailBody(draft));
    expect(emailText(draft, recipient)).toBe(`To: ${recipient}\nSubject: ${draft.subject}\n\n${emailBody(draft)}`);
  });
  /** Copying the letter remains usable before the patient knows the recipient address. */
  it("copies subject and body without requiring an address", () => {
    expect(emailText(draft, "")).toBe(`Subject: ${draft.subject}\n\n${emailBody(draft)}`);
  });
});
