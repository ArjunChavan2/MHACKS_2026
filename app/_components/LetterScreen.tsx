"use client";
/** @file Reviewed deterministic correspondence, citations, optional patient edits and PDF download; never sends a letter. */
import { useState } from "react";
import type { Draft } from "@/lib/types";
import LetterEditor, { type LetterEdits } from "./LetterEditor";
import { describeSource } from "./sources";

/**
 * Letter screen: click any paragraph to see its sources; edit wording (when `onSave` is given); download the PDF.
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
}: {
  draft: Draft;
  /** Persists patient wording and refreshes the current saved letter; omit to hide editing. */
  onSave?: (edits: LetterEdits) => Promise<void>;
  onTrack?: () => void;
}) {
  /** Editing blocks downloads and case navigation until saved or canceled. */
  const [editing, setEditing] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  /** Visible PDF failure; a failed request must never be downloaded as a document. */
  const [downloadError, setDownloadError] = useState<string | null>(null);

  /**
   * Downloads the reviewed draft as a PDF without submitting it (SPEC.md §4.5).
   * Displays HTTP/network failures instead of saving an error response as a PDF.
   * @returns Resolves after download or a visible failure; always releases busy state.
   * Side effects: calls the PDF API and starts a browser download.
   */
  async function download() {
    setBusy(true);
    setDownloadError(null);
    try {
      const res = await fetch("/api/letters/pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ draft }),
      });
      if (!res.ok)
        throw new Error("The PDF could not be prepared. Please try again.");
      const blob = await res.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `${draft.kind.replaceAll("_", "-")}.pdf`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (error) {
      setDownloadError(
        error instanceof Error
          ? error.message
          : "The PDF could not be prepared.",
      );
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
      {downloadError && (
        <p
          role="alert"
          className="rounded-lg bg-red-50 p-3 text-sm text-red-800"
        >
          {downloadError}
        </p>
      )}
      <button
        disabled={busy}
        onClick={download}
        className="paper-primary w-full"
      >
        {busy ? "Preparing PDF…" : "Download PDF"}
      </button>
      {onTrack && (
        <button onClick={onTrack} className="paper-secondary w-full">
          Track this case →
        </button>
      )}
      <p className="text-center text-xs text-[var(--paper-muted)]">
        {onTrack
          ? "Sending happens from the case screen and only with your approval (simulated in this demo)."
          : "Nothing is sent for you in this version. Review the letter, then send it yourself."}
      </p>
    </section>
  );
}
