"use client";
/** @file Reviewed deterministic correspondence, citations, optional patient edits and manual email composition; never sends a letter. */
import { useState } from "react";
import type { Draft } from "@/lib/types";
import LetterEditor, { type LetterEdits } from "./LetterEditor";
import { emailText, emailHref } from "@/lib/draft/email";
import { describeSource } from "./sources";

/**
 * Letter screen: click any paragraph to see its sources; edit wording (when `onSave` is given); copy an email or open a prefilled mail app.
 *
 * @param props.draft - The finished draft.
 * @param props.onSave - Saves patient wording; provided by each patient letter flow.
 * @param props.onTrack - Opens the case screen (dispute letters only).
 * @returns The letter screen.
 */
export default function LetterScreen({
  draft,
  onTrack,
  onSave,
  onRecipientSave,
}: {
  draft: Draft;
  /** Persists patient wording and refreshes the current saved letter; omit to hide editing. */
  onSave?: (edits: LetterEdits) => Promise<void>;
  onTrack?: () => void;
  /** Saves a patient-entered recipient without sending the letter. */
  onRecipientSave?: (email: string) => Promise<void>;
}) {
  /** Editing blocks email actions and case navigation until saved or canceled. */
  const [editing, setEditing] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);
  /** Recipient and email action feedback are local until the case accepts the address. */
  const [recipient, setRecipient] = useState(draft.recipientEmail ?? "");
  const [busy, setBusy] = useState(false);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [manualCopy, setManualCopy] = useState(false);
  /** Requires one complete address before opening a mail app; copying remains available without one. */
  const validRecipient =
    /^[^\s@<>?,;\r\n]+@[^\s@<>?,;\r\n]+\.[^\s@<>?,;\r\n]+$/.test(
      recipient.trim(),
    );

  /** Saves a valid or cleared address, exposing errors without losing the typed value. */
  async function saveRecipient() {
    if (recipient.trim() && !validRecipient) {
      setEmailError(
        "Enter a complete email address, such as billing@example.com.",
      );
      return false;
    }
    try {
      if (onRecipientSave && recipient.trim() !== (draft.recipientEmail ?? ""))
        await onRecipientSave(recipient.trim());
      setEmailError(null);
      return true;
    } catch (error) {
      setEmailError(
        error instanceof Error
          ? error.message
          : "The email address could not be saved.",
      );
      return false;
    }
  }

  /** Copies subject and the full saved letter; unavailable clipboard access opens a manual copy field. */
  async function copyEmail() {
    setBusy(true);
    setCopied(false);
    try {
      if (!(await saveRecipient())) return;
      await navigator.clipboard.writeText(emailText(draft, recipient.trim()));
      setCopied(true);
      setManualCopy(false);
    } catch {
      setManualCopy(true);
    } finally {
      setBusy(false);
    }
  }

  if (editing && onSave)
    return (
      <section className="paper-flow billless-letter-screen">
        <LetterEditor
          draft={draft}
          onCancel={() => setEditing(false)}
          onSave={async (edits) => {
            await onSave(edits);
            setSelected(null);
            setEditing(false);
          }}
        />
      </section>
    );

  return (
    <section className="paper-flow billless-letter-screen space-y-4">
      {onSave && (
        <button className="paper-secondary" onClick={() => setEditing(true)}>
          Edit letter
        </button>
      )}
      {draft.patientEdited && (
        <p role="status" className="paper-copy">
          Your edits are saved. Review the final letter before sending.
        </p>
      )}
      <div className="billless-document-card">
        <p className="text-xs text-[var(--paper-muted)]">
          {draft.patientEdited
            ? "Document-backed facts are preserved. Your added wording is labeled separately."
            : draft.author === "llm"
              ? "Wording drafted by AI; every fact was filled in by code from your confirmed bill and findings."
              : "Written from our standard template; every fact was filled in by code."}{" "}
          Tap a paragraph to see where its facts came from.
        </p>
        <h2 className="mt-3 font-semibold">Re: {draft.subject}</h2>
        <div className="mt-3 space-y-3 text-sm leading-relaxed">
          {draft.paragraphs.map((p, i) => (
            <button
              type="button"
              key={i}
              aria-expanded={selected === i}
              aria-controls="letter-evidence"
              onClick={() => setSelected(selected === i ? null : i)}
              className={`block w-full text-left cursor-pointer whitespace-pre-line rounded p-2 ${selected === i ? "bg-[var(--paper-surface)] ring-1 ring-[var(--paper-border)]" : "hover:bg-[var(--paper-surface)]"} ${i === draft.paragraphs.length - 1 ? "text-sm text-[var(--paper-muted)]" : ""}`}
            >
              {p.patientProvided && (
                <span className="block text-xs text-[var(--paper-muted)]">
                  Your wording
                </span>
              )}
              {p.text}
            </button>
          ))}
        </div>
        {selected !== null && (
          <div
            id="letter-evidence"
            className="mt-3 rounded-md bg-[var(--paper-surface)] p-3 text-sm ring-1 ring-[var(--paper-border)]"
          >
            {draft.paragraphs[selected].sources.length ? (
              <ul className="space-y-1 font-mono">
                {draft.paragraphs[selected].sources.map((s, i) => (
                  <li key={i}>{describeSource(s)}</li>
                ))}
              </ul>
            ) : (
              <p>
                {draft.paragraphs[selected].patientProvided
                  ? "This wording was added by you; it is not verified document evidence."
                  : "No facts from your documents in this paragraph."}
              </p>
            )}
          </div>
        )}
      </div>
      <div className="billless-email-compose">
        <label htmlFor="letter-recipient-email">
          {draft.kind === "appeal_letter" ? "Insurer email" : "Provider email"}
        </label>
        <input
          id="letter-recipient-email"
          type="email"
          value={recipient}
          maxLength={254}
          placeholder="billing@example.com"
          autoComplete="email"
          aria-invalid={Boolean(recipient && !validRecipient)}
          aria-describedby="letter-email-help"
          onChange={(event) => {
            setRecipient(event.target.value);
            setCopied(false);
          }}
          onBlur={() => {
            void saveRecipient();
          }}
        />
        <p id="letter-email-help" className="paper-copy">
          Use the address from your provider or insurer. You’ll review and send
          the email yourself.
        </p>
        {emailError && (
          <p role="alert" className="text-red-800">
            {emailError}
          </p>
        )}
        <div className="billless-email-actions">
          <button
            disabled={busy}
            onClick={copyEmail}
            className="paper-secondary"
          >
            {copied ? "Email copied ✓" : "Copy email"}
          </button>
          <a
            className="paper-primary"
            aria-disabled={!validRecipient}
            href={
              validRecipient ? emailHref(draft, recipient.trim()) : undefined
            }
            onClick={(event) => {
              if (!validRecipient) {
                event.preventDefault();
                setEmailError(
                  "Add the recipient’s email address to open your email app.",
                );
              }
            }}
          >
            Open in email app ↗
          </a>
        </div>
        {copied && (
          <p role="status" className="paper-copy">
            Subject and letter copied{recipient.trim() ? ", along with the recipient" : ""}. Paste them into your email.
          </p>
        )}
        {manualCopy && (
          <label>
            Copy email manually
            <textarea
              readOnly
              value={emailText(draft, recipient.trim())}
              rows={10}
              onFocus={(event) => event.target.select()}
            />
          </label>
        )}
        <p className="paper-copy">
          If your email app doesn’t open or the letter is cut short, use Copy
          email.
        </p>
      </div>
      {onTrack && (
        <button onClick={onTrack} className="paper-secondary w-full">
          Track this case →
        </button>
      )}
      <p className="text-center text-xs text-[var(--paper-muted)]">
        {onTrack
          ? "You can also track replies and follow-ups in your saved case."
          : "Nothing is sent until you choose Send in your email app."}
      </p>
    </section>
  );
}
