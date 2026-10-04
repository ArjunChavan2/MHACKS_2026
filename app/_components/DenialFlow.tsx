"use client";
/** @file Patient denial journey: confirmation, fixed demo criteria, cited records and reviewed correspondence. */
import { useEffect, useRef, useState } from "react";
import type { AppealResponse, CaseView } from "@/lib/cases/service";
import ConfirmPanel, { type DocState } from "./DocumentConfirmation";
import LetterScreen from "./LetterScreen";
import type { LetterEdits } from "./LetterEditor";

/**
 * Displays one denial on its existing case; reload reads saved evaluation rather than rechecking records.
 * @param props - Document state, correction setter and navigation to the persistent case.
 * @returns Confirmation, evidence review and PDF review. Nothing is submitted to an insurer.
 */
export default function DenialFlow({
  doc,
  onChange,
  onTrack,
}: {
  doc: DocState;
  onChange: (doc: DocState) => void;
  onTrack: () => void;
}) {
  /** Persisted deterministic evaluation and cited draft, restored without another check. */
  const [result, setResult] = useState<AppealResponse | null>(null);
  /** Patient navigation choice between policy evidence and correspondence. */
  const [letter, setLetter] = useState(false);
  /** Holds duplicate confirmation/check actions during an active request. */
  const [busy, setBusy] = useState(false);
  /** Visible confirmation, policy or connectivity failure; no draft is fabricated. */
  const [error, setError] = useState<string | null>(null);
  /** Immediate duplicate-submission guard while React renders its busy state. */
  const lock = useRef(false);
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/cases/${doc.ingest.caseId}`, { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok)
          throw new Error(
            "Could not restore the saved denial review. Retry by reopening your case.",
          );
        const view = (await response.json()) as CaseView;
        if (!cancelled && view.appeal?.documentId === doc.ingest.documentId)
          setResult(view.appeal);
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [doc.ingest.caseId, doc.ingest.documentId]);

  /** Saves appeal wording to the same case and refreshes the visible draft without rerunning policy checks. */
  async function saveLetterEdits(edits: LetterEdits) {
    const response = await fetch(`/api/cases/${doc.ingest.caseId}/letter`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(edits),
    });
    const view = await response.json();
    if (!response.ok) throw new Error(view.message ?? "Your letter could not be saved.");
    if (!view.draft) throw new Error("The saved letter is unavailable. Reopen this case.");
    setResult((current) => current ? { ...current, draft: view.draft } : current);
  }

  /** Locks patient-confirmed values before evaluating fixed rules; failed confirmation stays editable. */
  async function check() {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError(null);
    try {
      if (!doc.confirmed) {
        const response = await fetch(
          `/api/documents/${doc.ingest.documentId}/confirm`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              corrections: doc.corrections,
              confirmedPaths: doc.confirmedPaths,
              acknowledgeTotalsMismatch: doc.ackTotals,
            }),
          },
        );
        const confirmation = await response.json();
        if (!response.ok)
          throw new Error(
            confirmation.message ?? "Confirmation could not be saved.",
          );
        onChange({
          ...doc,
          confirmed: confirmation.ok,
          blocking: confirmation.blocking ?? [],
        });
        if (!confirmation.ok) return;
      }
      const response = await fetch("/api/appeals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ documentId: doc.ingest.documentId }),
      });
      const data = await response.json();
      if (!response.ok)
        throw new Error(
          data.message ??
            "The criteria could not be checked. A human can review this denial.",
        );
      setResult(data);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "The review could not be saved.",
      );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  return (
    <section className="paper-flow space-y-5" aria-busy={busy}>
      <p className="paper-kicker">Denial review</p>
      <h1 className="text-2xl font-semibold">
        Understand your denial and prepare the next step
      </h1>
      <p className="paper-copy">
        Check the notice first. Rules compare the named policy with original
        records from each connected provider. A missing criterion leads to a
        doctor documentation request.
      </p>
      <p className="rounded-lg bg-amber-50 p-3 text-sm">
        This demo supports policy WMH-MP-112 only. Its criteria are synthetic.
        Other policies require human review. The notice’s deadline is shown as
        printed; no extension is assumed.
      </p>
      {error && (
        <p role="alert" className="rounded-lg bg-red-50 p-3">
          {error}
        </p>
      )}
      {!result && (
        <>
          <ConfirmPanel
            title="Your denial notice"
            doc={doc}
            onChange={onChange}
          />
          <button disabled={busy} className="paper-primary" onClick={check}>
            {busy
              ? "Checking confirmed criteria…"
              : doc.confirmed
                ? "Check policy criteria"
                : "Confirm notice and check criteria"}
          </button>
        </>
      )}
      {result && (
        <div className="billless-document-card">
          <h2 className="font-semibold">Confirmed notice</h2>
          <p>
            {result.notice.insurer} · Reference {result.notice.referenceNumber}
          </p>
          <p>
            Notice date: {result.notice.letterDate ?? "Not recorded"}. Appeal
            deadline as printed:{" "}
            {result.notice.appealDeadline ?? "Not recorded"}.
          </p>
          <p>
            Send-to address as printed:{" "}
            {result.notice.appealAddress ?? "Not recorded"}.
          </p>
          <p className="paper-copy">
            Check the deadline and contact the insurer about available review
            options. Preparing a draft does not file it or extend the deadline.
          </p>
        </div>
      )}
      {result && !letter && (
        <>
          <div className="billless-document-card">
            <h2 className="font-semibold">
              {result.evaluation.policy?.title} · {result.evaluation.policy?.id}
            </h2>
            <p className="paper-copy">
              Records source: {result.recordsOrigin}. Providers searched:{" "}
              {result.providers.join(", ") || "None"}.
            </p>
          </div>
          {result.evaluation.criteria.map((criterion) => (
            <article className="billless-document-card" key={criterion.id}>
              <div className="flex flex-wrap justify-between gap-2">
                <h3 className="font-semibold">{criterion.text}</h3>
                <strong>
                  {criterion.status === "met"
                    ? "Documented"
                    : criterion.status === "unconfirmed"
                      ? "Needs confirmation"
                      : "Documentation missing"}
                </strong>
              </div>
              <p className="paper-copy text-sm">
                Searched: {criterion.searched}
              </p>
              {criterion.evidence.map((fact) => (
                <blockquote
                  key={fact.recordId}
                  className="mt-3 border-l-2 pl-3"
                >
                  <p>“{fact.text}”</p>
                  <cite className="text-sm not-italic">
                    {fact.provider} · {fact.recordedAt} · {fact.codeSystem}{" "}
                    {fact.code} · Record {fact.recordId}
                  </cite>
                </blockquote>
              ))}
              {criterion.needed && (
                <p className="mt-3">Ask your doctor for {criterion.needed}.</p>
              )}
            </article>
          ))}
          <p className="paper-copy">
            {result.evaluation.allMet
              ? "Each supported demo criterion is documented. Review the appeal and its citations before using it."
              : "Some criteria need more documentation. Review the request to your care team before appealing."}
          </p>
          <button className="paper-primary" onClick={() => setLetter(true)}>
            {result.evaluation.allMet
              ? "Review appeal letter"
              : "Review doctor documentation request"}
          </button>
        </>
      )}
      {result && letter && (
        <>
          <button
            className="paper-text-button"
            onClick={() => setLetter(false)}
          >
            Back to policy evidence
          </button>
          <LetterScreen draft={result.draft} onSave={saveLetterEdits} />
        </>
      )}
      <button className="paper-secondary" onClick={onTrack}>
        Open saved case
      </button>
      <p className="text-sm paper-copy">
        Preparing or downloading a letter does not send it. Your case keeps the
        original notice, evidence and draft.
      </p>
    </section>
  );
}
