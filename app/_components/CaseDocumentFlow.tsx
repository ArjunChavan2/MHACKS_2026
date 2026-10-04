"use client";
/** @file Patient attachment, confirmation and retry within an active case (SPEC.md §3.6, §4.2). */
import { useRef, useState, type ReactNode } from "react";
import type { CaseView, IngestResponse } from "@/lib/cases/service";
import type { CaseTask } from "@/lib/types";
import ConfirmPanel, { type DocState } from "./DocumentConfirmation";
import ProcessingStatus from "./ProcessingStatus";

/** Human-readable names for supported detected types, without interpreting document facts. */
const DOCUMENT_NAMES: Record<string, string> = {
  itemized_bill: "Itemized bill",
  eob: "Explanation of benefits (EOB)",
  revised_statement: "Revised statement",
};

/**
 * Calls an attachment/confirmation endpoint and preserves the server's visible error message.
 * @param url - Local endpoint path.
 * @param body - Validated on the server; never contains findings or savings.
 * @returns Parsed response of the caller's expected shape.
 * @throws {Error} For a failed response. Side effects: sends the requested local API mutation.
 */
async function post<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok)
    throw new Error(
      data.message ?? "The document could not be added. Please try again.",
    );
  return data as T;
}

/**
 * Adds supported administrative documents without leaving the saved case or replacing its original.
 * @param props - Latest case view, refresh callback and parent action lock.
 * @returns Upload, detected-type, correction/confirmation and recovery controls.
 * Side effects: stores uploads/associations, confirms fields, then refreshes server-derived state.
 */
export default function CaseDocumentFlow({
  view,
  onUpdated,
  onBusyChange,
  onDenial,
  children,
}: {
  /** Saved document list shown below the compact upload action. */
  children: ReactNode;
  /** Current saved case and resumable incoming documents. */
  view: CaseView;
  /** Reloads server state after a document operation. */
  onUpdated: () => Promise<void>;
  /** Routes a denial into its dedicated review without fulfilling a billing-paperwork task. */
  onDenial: (doc: DocState) => void;
  /** Holds other case buttons while document work is running. */
  onBusyChange: (busy: boolean) => void;
}) {
  /** Local confirmation edits are retained after failures and polling refreshes. */
  const [doc, setDoc] = useState<DocState | null>(null);
  /** Optional task selected by the patient, bound by the server before confirmation. */
  const [taskId, setTaskId] = useState("");
  /** Visible failure and activity state for this attachment flow. */
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [filename, setFilename] = useState<string | null>(null);
  const [retryFile, setRetryFile] = useState<File | null>(null);
  /** Immediate lock prevents rapid duplicate submissions. */
  const lock = useRef(false);
  /** Native file picker opened by the Case documents upload button. */
  const fileInput = useRef<HTMLInputElement>(null);
  /** Latest case view, including pending uploads available to reopen after refresh. */
  const pending = view.documents.filter(
    (d) =>
      !d.confirmed &&
      (d.ingest.result.kind === "denial" ||
        d.ingest.result.kind === "eob" ||
        (d.ingest.result.kind === "bill" &&
          d.ingest.result.bill.docType !== "balance_statement")),
  );
  /** Eligible pending tasks; other record types require human handling. */
  const tasks = view.state.tasks.filter(
    (t) => t.status !== "done" && supportedTask(t),
  );

  /**
   * Serializes one document operation and preserves the case on failures.
   * @param operation - Upload/confirm work; errors become visible and are never treated as success.
   * Side effects: locks local and parent controls until the operation settles.
   */
  async function run(operation: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    onBusyChange(true);
    setError(null);
    try {
      await operation();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "The document could not be processed.",
      );
    } finally {
      lock.current = false;
      setBusy(false);
      onBusyChange(false);
      setFilename(null);
    }
  }

  /**
   * Registers the current task association; never marks a receipt as proof.
   * @param documentId - Stored incoming document on this case.
   * Side effects: posts the association, with confirmation/checks still enforced by the server.
   */
  async function associate(documentId: string) {
    await post(`/api/cases/${view.caseId}/documents`, {
      documentId,
      ...(taskId ? { taskId } : {}),
    });
  }

  /**
   * Opens existing extraction values for confirmation without another model call.
   * @param ingest - Stored upload response.
   * @param confirmed - Whether server values are already locked.
   * Side effects: replaces local editor state only on an explicit patient selection.
   */
  function openDocument(ingest: IngestResponse, confirmed = false) {
    const saved = view.documents.find(
      (d) => d.ingest.documentId === ingest.documentId,
    );
    if (ingest.result.kind === "denial") {
      setDoc(null);
      setError(null);
      setRetryFile(null);
      onDenial({
        ingest,
        confirmed: confirmed || Boolean(saved?.confirmed),
        corrections: saved?.confirmedValues ?? {},
        confirmedPaths: [],
        ackType: false,
        ackTotals: false,
        blocking: [],
      });
      return;
    }
    if (saved?.taskId) setTaskId(saved.taskId);
    setDoc({
      ingest,
      confirmed: confirmed || Boolean(saved?.confirmed),
      corrections: {},
      confirmedPaths: [],
      ackTotals: false,
      blocking: [],
      ackType: false,
    });
    setError(null);
    setRetryFile(null);
  }

  /**
   * Uploads into the current case and retains the extracted document if association is refused.
   * @param file - Synthetic PDF/photo chosen by the patient.
   * Side effects: ingests once, then binds to a task and refreshes the case document list.
   */
  async function upload(file: File) {
    await run(async () => {
      setFilename(file.name);
      setRetryFile(null);
      let ingest: IngestResponse;
      try {
        const body = new FormData();
        body.append("file", file);
        body.append("caseId", view.caseId);
        const response = await fetch("/api/documents", {
          method: "POST",
          body,
        });
        const data = await response.json();
        if (!response.ok)
          throw new Error(
            data.message ?? "Upload failed. Try a clearer photo or PDF.",
          );
        ingest = data as IngestResponse;
      } catch (err) {
        setRetryFile(file);
        throw err;
      }
      const result = ingest.result;
      if (result.kind === "denial") {
        openDocument(ingest);
        await onUpdated();
        return;
      }
      if (!(
        result.kind === "eob" ||
        (result.kind === "bill" &&
          ["itemized_bill", "revised_statement"].includes(result.bill.docType))
      )) {
        await onUpdated();
        throw new Error(
          "This document needs human handling. Add an itemized bill, EOB or revised statement here.",
        );
      }
      openDocument(ingest);
      try {
        await associate(ingest.documentId);
      } finally {
        await onUpdated();
      }
    });
  }

  /**
   * Confirms patient edits, then resumes checks; a failed check can retry without re-uploading.
   * Side effects: records confirmation/association and refreshes server state; sends no correspondence.
   */
  async function confirm() {
    if (!doc) return;
    await run(async () => {
      await associate(doc.ingest.documentId);
      const alreadyConfirmed =
        doc.confirmed ||
        view.documents.some(
          (d) => d.ingest.documentId === doc.ingest.documentId && d.confirmed,
        );
      if (!alreadyConfirmed) {
        try {
          const result = await post<{ ok: boolean; blocking?: string[] }>(
            `/api/documents/${doc.ingest.documentId}/confirm`,
            {
              corrections: doc.corrections,
              confirmedPaths: doc.confirmedPaths,
              acknowledgeTotalsMismatch: doc.ackTotals,
              acknowledgeDocType: doc.ackType,
            },
          );
          if (!result.ok) {
            setDoc({ ...doc, blocking: result.blocking ?? [] });
            return;
          }
          setDoc({ ...doc, confirmed: true });
        } finally {
          await onUpdated();
        }
      }
      await associate(doc.ingest.documentId);
      await onUpdated();
      setDoc(null);
      setTaskId("");
    });
  }

  return (
    <section
      className="billless-document-card space-y-4"
      id="case-document-flow"
      aria-label="Case documents"
    >
      <div className="billless-case-documents-heading">
        <h3 className="text-lg font-semibold">Case documents</h3>
        <button
          type="button"
          className="paper-secondary"
          disabled={busy}
          onClick={() => fileInput.current?.click()}
        >
          Upload document
        </button>
      </div>
      <input
        ref={fileInput}
        type="file"
        className="sr-only"
        aria-label="Upload case document"
        accept="application/pdf,image/jpeg,image/png,image/webp,image/heic"
        disabled={busy}
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void upload(file);
          event.target.value = "";
        }}
      />
      {children}
      {doc && tasks.length > 0 && (
        <label className="billless-goal-label">
          Which request is this for?
          <select
            value={taskId}
            disabled={busy}
            onChange={(e) => setTaskId(e.target.value)}
          >
            <option value="">Additional document (no specific request)</option>
            {tasks.map((t) => (
              <option key={t.id} value={t.id}>
                {t.documentNeeded} — {t.responsibleParty}
              </option>
            ))}
          </select>
        </label>
      )}
      {filename && <ProcessingStatus filename={filename} />}
      {error && (
        <p role="alert" className="billless-refresh-warning">
          {error}
        </p>
      )}
      {retryFile && (
        <button
          className="paper-secondary"
          disabled={busy}
          onClick={() => upload(retryFile)}
        >
          Retry reading {retryFile.name}
        </button>
      )}
      {!doc && pending.length > 0 && (
        <div className="space-y-2">
          <p className="paper-copy">Waiting for your confirmation:</p>
          {pending.map((d) => (
            <button
              key={d.ingest.documentId}
              className="paper-secondary"
              disabled={busy}
              onClick={() => openDocument(d.ingest)}
            >
              {d.fileName ?? "Open received document"}
            </button>
          ))}
        </div>
      )}
      {doc && (
        <>
          <p className="paper-copy">
            Detected:{" "}
            <strong>
              {doc.ingest.result.kind === "eob"
                ? DOCUMENT_NAMES.eob
                : doc.ingest.result.kind === "bill"
                  ? DOCUMENT_NAMES[doc.ingest.result.bill.docType]
                  : "Unsupported document"}
            </strong>
          </p>
          {doc.ingest.result.meta.source === "saved-fixture" && (
            <p className="paper-copy">
              Synthetic sample — read from a saved answer without AI.
            </p>
          )}
          <fieldset disabled={busy || doc.confirmed}>
            <ConfirmPanel
              key={doc.ingest.documentId}
              title="Check the arrived document"
              doc={doc}
              onChange={setDoc}
            />
          </fieldset>
          <div className="flex flex-wrap gap-3">
            <button className="paper-primary" disabled={busy} onClick={confirm}>
              {busy
                ? "Checking…"
                : doc.confirmed
                  ? "Retry document checks"
                  : "Confirm and update my case"}
            </button>
            <button
              className="paper-secondary"
              disabled={busy}
              onClick={() => setDoc(null)}
            >
              Return to case
            </button>
          </div>
        </>
      )}
    </section>
  );
}

/**
 * Lists tasks supported by the current document schema rather than promising clinical ingestion.
 * @param task - Case paperwork task.
 * @returns Whether the task is a revised statement or a known EOB description. Pure.
 */
function supportedTask(task: CaseTask): boolean {
  return [
    "revised statement",
    "eob",
    "explanation of benefits",
    "insurance explanation of benefits",
  ].includes(task.documentNeeded.trim().toLowerCase());
}
