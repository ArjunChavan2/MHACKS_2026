"use client";

/** @file Patient wording editor; document-backed paragraphs remain read-only. */
import { useState } from "react";
import type { Draft } from "@/lib/types";

/** Payload includes current text to reject stale saves, without accepting any client-supplied facts. */
export type LetterEdits = {
  expectedText: string[];
  edits: { index: number; text: string }[];
  personalNote: string;
  reset: boolean;
};

/**
 * Edits source-free template wording and a patient explanation, with a preview before saving.
 * @param props.draft - Latest saved letter with server-protected originals.
 * @param props.onSave - Persists edits and refreshes the case; rejects on failure.
 * @param props.onCancel - Closes the editor without saving.
 * @returns Accessible edit fields or a preview, including visible save failures.
 */
export default function LetterEditor({
  draft,
  onSave,
  onCancel,
}: {
  draft: Draft;
  onSave: (edits: LetterEdits) => Promise<void>;
  onCancel: () => void;
}) {
  /** Original paragraph indices remain stable even after an added personal note. */
  const original = draft.originalParagraphs ?? draft.paragraphs;
  /** Working text, never applied to the saved draft until the server accepts it. */
  const [texts, setTexts] = useState(
    original.map((p, i) => draft.paragraphs[i]?.text ?? p.text),
  );
  /** Patient explanation is separate from the source-backed evidence. */
  const [note, setNote] = useState(draft.personalNote ?? "");
  /** Preview and request state are local to this editing session. */
  const [preview, setPreview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Submits only editable wording or requests the server-held original. */
  async function save(reset: boolean) {
    setBusy(true);
    setError(null);
    try {
      await onSave({
        expectedText: draft.paragraphs.map((p) => p.text),
        edits: reset
          ? []
          : original.flatMap((p, index) =>
              !p.sources.length && index < original.length - 1
                ? [{ index, text: texts[index] }]
                : [],
            ),
        personalNote: note,
        reset,
      });
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Your edits could not be saved.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="billless-letter-editor">
      <h2>{preview ? "Preview your edits" : "Edit your letter"}</h2>
      <p className="paper-copy">
        Personalize the wording or add your explanation. To change amounts,
        dates, or evidence, correct your bill or EOB details.
      </p>
      {original.map((paragraph, index) => (
        <div key={index} className="billless-letter-edit-paragraph">
          {preview ||
          paragraph.sources.length > 0 ||
          index === original.length - 1 ? (
            <>
              <p className="whitespace-pre-line">
                {paragraph.sources.length || index === original.length - 1
                  ? paragraph.text
                  : texts[index]}
              </p>
              {!preview && paragraph.sources.length > 0 && (
                <small>From your confirmed documents · read-only</small>
              )}
            </>
          ) : (
            <label>
              Paragraph {index + 1}
              <textarea
                aria-label={`Paragraph ${index + 1}`}
                value={texts[index]}
                onChange={(event) =>
                  setTexts(
                    texts.map((text, i) =>
                      i === index ? event.target.value : text,
                    ),
                  )
                }
                maxLength={5000}
                rows={3}
              />
            </label>
          )}
          {index === original.length - 2 && preview && note.trim() && (
            <div className="billless-personal-note">
              <small>Your added wording</small>
              <p className="whitespace-pre-line">{note}</p>
            </div>
          )}
        </div>
      ))}
      {!preview && (
        <label>
          Your explanation (optional)
          <textarea
            aria-label="Your explanation (optional)"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            maxLength={5000}
            rows={4}
            placeholder="Add what you want the recipient to understand."
          />
        </label>
      )}
      {error && (
        <p role="alert" className="text-red-800">
          {error}
        </p>
      )}
      <div className="billless-letter-editor-actions">
        <button
          className="paper-secondary"
          disabled={busy}
          onClick={() => setPreview(!preview)}
        >
          {preview ? "Keep editing" : "Preview"}
        </button>
        <button
          className="paper-primary"
          disabled={
            busy ||
            original.some(
              (p, i) =>
                !p.sources.length &&
                i < original.length - 1 &&
                !texts[i].trim(),
            )
          }
          onClick={() => save(false)}
        >
          {busy ? "Saving…" : "Save changes"}
        </button>
        <button
          className="paper-source-button"
          disabled={busy}
          onClick={() => save(true)}
        >
          Reset to original
        </button>
        <button className="paper-secondary" disabled={busy} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}
