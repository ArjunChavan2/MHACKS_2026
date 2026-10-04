"use client";
/**
 * @file The patient flow in the browser: start → confirm → audit → letter → case (SPEC.md §6
 * MVP 1–2). The case screen (`CaseScreen`) tracks approvals, responses, and verification.
 *
 * Talks only to our API routes. Never computes findings or writes facts itself: findings come from
 * `/api/audit` and letters from `/api/letters`. Labels anything that came from a saved sample
 * document so a demo never passes a fixture off as live (SPEC.md §2 rule 9).
 */
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import BillyGuide, { ReviewProgress, type ReviewStep } from "./BillyGuide";
import type { RecordsOrigin } from "@/lib/finchnode/live";
import type {
  AuditResponse,
  CaseView,
  IngestResponse,
} from "@/lib/cases/service";
import { usd } from "@/lib/format";
import CaseScreen from "./CaseScreen";
import ConfirmPanel, {
  confirmationProgress,
  type DocState,
} from "./DocumentConfirmation";
import ProcessingStatus from "./ProcessingStatus";
import CasePreferencesPanel from "./CasePreferencesPanel";
import type { CasePreferencesInput } from "@/lib/cases/preferences";
import { describeSource } from "./sources";
import type { Draft, ExtractedBill, Finding } from "@/lib/types";

/** Which screen is showing, including the saved-case tracking screen. */
type Step = ReviewStep | "case";

/**
 * Sends JSON to an API route and returns the parsed reply or throws with the server's message.
 *
 * @param url - API path.
 * @param body - JSON body.
 * @returns Parsed JSON.
 * @throws {Error} With the server's message on non-2xx responses.
 */
async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message ?? "Request failed");
  return data as T;
}

/**
 * Loads a saved case.
 *
 * @param id - Case ID.
 * @returns The case view.
 * @throws {Error} With a patient-readable message when the case is missing or the request fails.
 */
async function fetchCase(id: string): Promise<CaseView> {
  const res = await fetch(`/api/cases/${encodeURIComponent(id)}`, {
    cache: "no-store",
  });
  if (res.status === 404)
    throw new Error("That case wasn't found. Start a new one below.");
  const data = await res.json();
  if (!res.ok) throw new Error(data.message ?? "Couldn't load the case");
  return data as CaseView;
}

/**
 * Root component for the MVP 1 flow.
 *
 * @returns The current screen.
 */
export default function BillAuditApp() {
  /** Latest explicit setup choices; saved before intake can advance. */
  const [preferences, setPreferences] = useState<CasePreferencesInput>({
    goal: "Review my medical bill",
    noPayments: true,
    pauseContact: false,
  });
  /** Whether setup choices are safely persisted for the current case. */
  const [preferencesSaved, setPreferencesSaved] = useState(false);
  /** Current file request and the last failed file retained for an explicit retry. */
  const [processingFile, setProcessingFile] = useState<string | null>(null);
  const [retryFile, setRetryFile] = useState<File | null>(null);
  /** Synchronous lock prevents double submissions before React updates disabled controls. */
  const running = useRef(false);
  const [step, setStep] = useState<Step>("start");
  const [bill, setBill] = useState<DocState | null>(null);
  const [eob, setEob] = useState<DocState | null>(null);
  const [audit, setAudit] = useState<AuditResponse | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** Combined document review progress shown beside the action that submits confirmation. */
  const reviewProgress = [bill, eob].reduce(
    (counts, doc) => {
      if (!doc) return counts;
      const progress = confirmationProgress(doc);
      return {
        total: counts.total + progress.total,
        reviewed: counts.reviewed + progress.reviewed,
        remaining: counts.remaining + progress.remaining,
      };
    },
    { total: 0, reviewed: 0, remaining: 0 },
  );

  const caseId = bill?.ingest.caseId ?? eob?.ingest.caseId ?? null;

  const usedSample = [bill, eob].some(
    (d) => d?.ingest.result.meta.source === "saved-fixture",
  );

  /**
   * Wraps an async action with busy and error state.
   *
   * @param fn - Action to run.
   */
  async function run(fn: () => Promise<void>) {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      running.current = false;
      setBusy(false);
    }
  }

  /**
   * Routes a newly ingested document into bill or EOB state.
   *
   * @param ingest - Server response.
   */
  function accept(ingest: IngestResponse) {
    const state: DocState = {
      ingest,
      corrections: {},
      confirmedPaths: [],
      ackTotals: false,
      confirmed: false,
      blocking: [],
    };
    const r = ingest.result;
    if (r.kind === "denial")
      throw new Error(
        "Denial letters need the appeal review flow. Add a bill or EOB here.",
      );
    if (r.kind === "unsupported") throw new Error(r.reason);
    if (r.kind === "eob") setEob(state);
    else setBill(state);
  }

  /**
   * Resumes at the furthest step a saved case reached.
   *
   * @param view - The case as loaded from the server.
   */
  function applyCase(view: CaseView) {
    const saved = view.state.preferences;
    setPreferences({
      goal: saved.goal ?? "Review my medical bill",
      noPayments: saved.noPayments,
      pauseContact: saved.pauseContact,
    });
    setPreferencesSaved(Boolean(saved.version));
    for (const d of view.documents) {
      const r = d.ingest.result;
      // Revised statements belong to case tracking, not the original bill slot.
      if (
        r.kind === "denial" ||
        r.kind === "unsupported" ||
        (r.kind === "bill" && r.bill.docType === "revised_statement")
      )
        continue;
      const state: DocState = {
        ingest: d.ingest,
        corrections: {},
        confirmedPaths: [],
        ackTotals: false,
        confirmed: d.confirmed,
        blocking: [],
      };
      if (r.kind === "eob") setEob(state);
      else setBill(state);
    }
    setAudit(view.audit);
    setDraft(view.draft);
    const tracking =
      view.draft?.kind === "dispute_letter" &&
      view.state.phase !== "audited" &&
      view.state.phase !== "intake";
    setStep(
      tracking
        ? "case"
        : view.draft
          ? "letter"
          : view.audit
            ? "audit"
            : view.documents.some(
                  (d) =>
                    !d.confirmed &&
                    d.ingest.result.kind === "bill" &&
                    d.ingest.result.bill.docType === "itemized_bill",
                )
              ? "confirm"
              : "start",
    );
  }

  // Resume a saved case named in the URL (?case=…) once, on first load.
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("case");
    if (!id) return;
    let cancelled = false;
    fetchCase(id)
      .then((view) => {
        if (!cancelled) applyCase(view);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        window.history.replaceState(null, "", window.location.pathname);
        setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Keep the case ID in the URL so a reload or shared link resumes the case.
  useEffect(() => {
    const url = new URL(window.location.href);
    if (!caseId || url.searchParams.get("case") === caseId) return;
    url.searchParams.set("case", caseId);
    window.history.replaceState(null, "", url);
  }, [caseId]);

  /** Uploads a file through Gemini extraction. */
  async function upload(file: File) {
    await run(async () => {
      setProcessingFile(file.name);
      setRetryFile(null);
      try {
        const form = new FormData();
        form.append("file", file);
        if (caseId) form.append("caseId", caseId);
        const res = await fetch("/api/documents", {
          method: "POST",
          body: form,
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.message ?? "Upload failed");
        accept(data as IngestResponse);
      } catch (err) {
        setRetryFile(file);
        throw err;
      } finally {
        setProcessingFile(null);
      }
    });
  }

  /** Loads a saved synthetic sample through the labeled no-AI path. */
  async function loadSample(name: string) {
    await run(async () =>
      accept(
        await postJson<IngestResponse>("/api/documents/sample", {
          name,
          caseId,
        }),
      ),
    );
  }

  /** Loads the demo pair (sample bill and sample EOB). */
  async function loadDemoPair() {
    await run(async () => {
      const b = await postJson<IngestResponse>("/api/documents/sample", {
        name: "sample-bill",
        caseId: null,
      });
      accept(b);
      accept(
        await postJson<IngestResponse>("/api/documents/sample", {
          name: "sample-eob",
          caseId: b.caseId,
        }),
      );
    });
  }

  /**
   * Persists explicit preferences and blocks progression if the save fails.
   * @param id - Current case ID.
   * Side effects: records the patient's choices on the server; sends nothing.
   */
  async function savePreferences(id: string) {
    const res = await fetch(`/api/cases/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(preferences),
    });
    const data = await res.json();
    if (!res.ok)
      throw new Error(
        data.message ?? "Your choices could not be saved. Please try again.",
      );
    setPreferencesSaved(true);
  }

  /** Moves on from the start screen once a bill is present. */
  async function next() {
    if (!caseId) return;
    await run(async () => {
      await savePreferences(caseId);
      if (
        bill?.ingest.result.kind === "bill" &&
        bill.ingest.result.bill.docType === "balance_statement"
      )
        setStep("request");
      else setStep("confirm");
    });
  }

  /**
   * Submits one document's confirmation.
   *
   * @param doc - Document state.
   * @param set - State setter for that document.
   * @returns Whether it locked.
   */
  async function confirmOne(
    doc: DocState,
    set: (d: DocState) => void,
  ): Promise<boolean> {
    if (doc.confirmed) return true;
    const r = await postJson<{ ok: boolean; blocking?: string[] }>(
      `/api/documents/${doc.ingest.documentId}/confirm`,
      {
        corrections: doc.corrections,
        confirmedPaths: doc.confirmedPaths,
        acknowledgeTotalsMismatch: doc.ackTotals,
      },
    );
    set({ ...doc, confirmed: r.ok, blocking: r.blocking ?? [] });
    return r.ok;
  }

  /** Confirms both documents, then runs the audit. */
  async function confirmAndAudit() {
    await run(async () => {
      if (!bill) return;
      if (!preferencesSaved && caseId) await savePreferences(caseId);
      const okBill = await confirmOne(bill, setBill);
      const okEob = eob ? await confirmOne(eob, setEob) : true;
      if (!okBill || !okEob) return;
      setAudit(
        await postJson<AuditResponse>("/api/audit", {
          caseId,
          billId: bill.ingest.documentId,
          eobId: eob?.ingest.documentId ?? null,
        }),
      );
      applyCase(await fetchCase(caseId!));
      setDraft(null);
      setStep("audit");
    });
  }

  /** Reopens the same unsent case; the server invalidates outdated findings and letter drafts first. */
  async function correctDetails() {
    await run(async () => {
      if (!caseId) return;
      const view = await postJson<CaseView>(
        `/api/cases/${encodeURIComponent(caseId)}/reopen`,
        {},
      );
      applyCase(view);
      setStep("confirm");
    });
  }

  /** Requests the dispute letter. */
  async function makeLetter() {
    await run(async () => {
      if (!bill) return;
      const { draft } = await postJson<{ draft: Draft }>("/api/letters", {
        caseId,
        billId: bill.ingest.documentId,
        eobId: eob?.ingest.documentId ?? null,
      });
      setDraft(draft);
      setStep("letter");
    });
  }

  /** Requests the itemized-bill request draft for a balance statement. */
  async function makeRequest() {
    await run(async () => {
      if (!bill) return;
      const { draft } = await postJson<{ draft: Draft }>(
        "/api/requests/itemized",
        { documentId: bill.ingest.documentId },
      );
      setDraft(draft);
      setStep("letter");
    });
  }

  /** Starts over. */
  function reset() {
    window.history.replaceState(null, "", window.location.pathname);
    setPreferencesSaved(false);
    setRetryFile(null);
    setPreferences({
      goal: "Review my medical bill",
      noPayments: true,
      pauseContact: false,
    });
    setStep("start");
    setBill(null);
    setEob(null);
    setAudit(null);
    setDraft(null);
    setError(null);
  }

  return (
    <main className="paper-app" aria-busy={busy}>
      <header className="paper-header billless-site-header">
        <Link href="/" className="paper-wordmark" aria-label="BillLess home">
          Bill<span>Less</span>
          <span className="billless-brand-dot">.</span>
        </Link>
        <p className="paper-header-label">
          A little less worry. A clearer next step.
        </p>
        <span className="paper-badge">
          {usedSample ? "Synthetic demo" : "Patient workspace"}
        </span>
        {step !== "start" && (
          <button disabled={busy} onClick={reset} className="paper-text-button">
            Start over
          </button>
        )}
      </header>
      {step !== "case" && <ReviewProgress step={step} />}
      {step !== "case" && (
        <BillyGuide
          key={step}
          step={step}
          busy={busy}
          error={Boolean(error)}
          noFindings={step === "audit" && audit?.findings.length === 0}
        />
      )}
      {usedSample && (
        <div className="paper-flow">
          <p className="mb-4 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900 ring-1 ring-amber-200">
            Sample document (synthetic data), read without AI from a saved
            answer. Same checks as a live upload.
          </p>
        </div>
      )}
      {error && (
        <p
          role="alert"
          className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-800 ring-1 ring-red-200"
        >
          {error}
        </p>
      )}

      {processingFile && <ProcessingStatus filename={processingFile} />}
      {retryFile && !busy && (
        <div className="paper-flow">
          <button className="paper-secondary" onClick={() => upload(retryFile)}>
            Retry reading {retryFile.name}
          </button>
          <p className="paper-copy">
            Check your saved case before retrying if the connection dropped
            after upload.
          </p>
        </div>
      )}
      {step === "start" && (
        <CasePreferencesPanel
          value={preferences}
          disabled={busy}
          onChange={(value) => {
            setPreferences(value);
            setPreferencesSaved(false);
          }}
        />
      )}
      {step === "start" && (
        <StartScreen
          bill={bill}
          eob={eob}
          busy={busy}
          onUpload={upload}
          onSample={loadSample}
          onDemo={loadDemoPair}
          onNext={next}
        />
      )}
      {step === "confirm" && bill && (
        <section className="paper-flow space-y-6">
          <ConfirmPanel title="Your bill" doc={bill} onChange={setBill} />
          {eob && (
            <ConfirmPanel
              title="Your explanation of benefits (EOB)"
              doc={eob}
              onChange={setEob}
            />
          )}
          <div className="billless-confirm-action">
            <div className="billless-action-progress">
              <p aria-live="polite">
                {reviewProgress.remaining
                  ? `${reviewProgress.remaining} ${reviewProgress.remaining === 1 ? "item" : "items"} left to review`
                  : "Ready to check your bill"}
              </p>
              <progress
                aria-label="Bill and EOB review progress"
                max={100}
                value={
                  reviewProgress.total
                    ? Math.round(
                        (reviewProgress.reviewed / reviewProgress.total) * 100,
                      )
                    : 100
                }
              />
              <small>
                {reviewProgress.total
                  ? `${reviewProgress.reviewed} of ${reviewProgress.total} items reviewed`
                  : "No flagged fields"}
              </small>
            </div>
            <button
              disabled={busy}
              onClick={confirmAndAudit}
              className="paper-primary"
            >
              {busy ? "Checking…" : "Confirm and check my bill"}
            </button>
          </div>
        </section>
      )}
      {step === "audit" && audit && bill?.ingest.result.kind === "bill" && (
        <AuditScreen
          audit={audit}
          bill={bill.ingest.result.bill}
          documentId={bill.ingest.documentId}
          busy={busy}
          onLetter={makeLetter}
          onCorrect={correctDetails}
        />
      )}
      {step === "request" && bill && (
        <section className="paper-flow space-y-4 rounded-xl bg-white p-5 ring-1 ring-[var(--paper-border)]">
          <h2 className="text-lg font-semibold">
            Let’s get the itemized details
          </h2>
          <p className="text-sm text-[var(--paper-muted)]">
            Your statement shows a total, but we need individual charges to
            review it. Prepare a request for an itemized bill from your
            provider.
          </p>
          <p className="text-sm text-[var(--paper-muted)]">
            You can also download your EOB from your insurer’s website or app.
          </p>
          <button
            disabled={busy}
            onClick={makeRequest}
            className="paper-primary w-full"
          >
            Draft my itemized-bill request
          </button>
        </section>
      )}
      {step === "letter" && draft && (
        <LetterScreen
          draft={draft}
          onTrack={
            draft.kind === "dispute_letter" ? () => setStep("case") : undefined
          }
        />
      )}
      {step === "case" && caseId && <CaseScreen caseId={caseId} />}
    </main>
  );
}

/**
 * Start screen: upload documents or load samples.
 *
 * @param props.bill - Bill state, once loaded.
 * @param props.eob - EOB state, once loaded.
 * @param props.busy - Whether a request is running.
 * @param props.onUpload - Uploads a file for AI reading.
 * @param props.onSample - Loads one named sample.
 * @param props.onDemo - Loads the sample bill and EOB together.
 * @param props.onNext - Continues to confirmation (or the request path for balance statements).
 * @returns The start screen.
 */
function StartScreen(props: {
  bill: DocState | null;
  eob: DocState | null;
  busy: boolean;
  onUpload: (f: File) => void;
  onSample: (name: string) => void;
  onDemo: () => void;
  onNext: () => void;
}) {
  const { bill, eob, busy } = props;
  return (
    <section className="paper-flow billless-upload-flow">
      <div className="billless-upload-grid">
        <UploadSlot
          title="Your bill"
          label="Add your bill"
          description="Upload your bill. We’ll help you request itemized details if needed."
          ready={Boolean(bill)}
          busy={busy}
          onUpload={props.onUpload}
        />
        <UploadSlot
          title="Insurance explanation"
          label="Add an EOB"
          description="Optional. Your explanation of benefits (EOB) shows what insurance paid and what you may owe."
          ready={Boolean(eob)}
          busy={busy}
          optional
          onUpload={props.onUpload}
        />
      </div>
      <div className="billless-continue-row">
        <div className="billless-action-progress">
          <p>
            {bill
              ? "Your bill is ready to confirm"
              : "Add your bill to continue"}
          </p>
          <progress
            aria-label="Upload preparation progress"
            max={1}
            value={bill ? 1 : 0}
          />
          <small>{eob ? "Bill and EOB added" : "EOB optional"}</small>
        </div>
        <button
          disabled={!bill || busy}
          onClick={props.onNext}
          className="paper-primary"
        >
          {busy ? "Reading your document…" : "Continue to confirm →"}
        </button>
      </div>
      <details className="billless-demo">
        <summary>Just exploring? Try a synthetic demo</summary>
        <div className="billless-demo-actions">
          <button
            disabled={busy}
            onClick={props.onDemo}
            className="paper-secondary"
          >
            Sample bill + EOB
          </button>
          <button
            disabled={busy}
            onClick={() => props.onSample("balance-statement")}
            className="paper-text-button"
          >
            Only a balance statement
          </button>
          <button
            disabled={busy}
            onClick={() => props.onSample("bill-broken-totals")}
            className="paper-text-button"
          >
            Bill with broken totals
          </button>
        </div>
      </details>
    </section>
  );
}

/**
 * A labeled upload slot with its document requirement and detected receipt status.
 * @param props - Administrative display copy, ready/busy state, and the existing intake callback.
 * @returns A keyboard-accessible file input. The server still identifies the document type.
 * Does not interpret documents or bypass patient confirmation (SPEC.md §4.2).
 */
function UploadSlot({
  title,
  label,
  description,
  ready,
  busy,
  optional = false,
  onUpload,
}: {
  /** Patient-facing document heading. */ title: string;
  /** Accessible file-input action label. */ label: string;
  /** Plain-language document description. */ description: string;
  /** A document of this type has been received. */ ready: boolean;
  /** An intake request is running. */ busy: boolean;
  /** Whether the document can be omitted. */ optional?: boolean;
  /** Existing server-backed upload action, called with the selected file. */ onUpload: (
    file: File,
  ) => void;
}) {
  return (
    <div className={`billless-upload-slot ${ready ? "is-ready" : ""}`}>
      <div className="billless-upload-slot-heading">
        <span className="billless-document-icon" aria-hidden="true">
          <svg
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
            <path d="M14 3v6h6M8 13h8M8 17h5" />
          </svg>
        </span>
        <span className="billless-slot-tag">
          {optional ? "OPTIONAL" : "START HERE"}
        </span>
      </div>
      <h2>{title}</h2>
      <p className="paper-copy">{description}</p>
      <label className="billless-dropzone">
        <span className="billless-upload-plus" aria-hidden="true">
          {ready ? "✓" : "+"}
        </span>
        <strong>
          {busy ? "Reading document…" : ready ? "Document added" : label}
        </strong>
        <span>
          {ready ? "Choose another file to replace it" : "PDF or a clear photo"}
        </span>
        <input
          type="file"
          accept="application/pdf,image/*"
          className="sr-only"
          aria-label={label}
          disabled={busy}
          onChange={(event) => {
            if (event.target.files?.[0]) onUpload(event.target.files[0]);
            event.target.value = "";
          }}
        />
      </label>
    </div>
  );
}

/**
 * Labels where the searched records came from, so live and saved data are never confused.
 *
 * @param origin - Records origin from the audit, if known.
 * @returns A short parenthetical, or "" when unknown.
 */
function recordsOriginLabel(origin: RecordsOrigin | undefined): string {
  if (origin === "live-sandbox") return " (live FinchNode sandbox, synthetic)";
  if (origin === "demo-api") return " (FinchNode demo API, synthetic)";
  if (origin === "saved-snapshot")
    return " (saved FinchNode snapshot, synthetic)";
  return "";
}

/**
 * Responsive Paper case review driven entirely by the server audit (SPEC.md §4.3–4.4).
 * Preserves rule explanations and verbatim evidence; never invents findings or savings.
 *
 * @param props.audit - Deterministic findings, searched providers, and amounts in integer cents.
 * @param props.bill - Stored document values used only for the inspection table; includes saved corrections.
 * @param props.documentId - Original bill document identifier for evidence preview links.
 * @param props.busy - Whether a draft request is running.
 * @param props.onLetter - Generates a draft for patient review; sends nothing.
 * @returns Desktop two-column review or stacked mobile review, including no-findings state.
 */
function AuditScreen({
  audit,
  bill,
  documentId,
  busy,
  onLetter,
  onCorrect,
}: {
  /** Audit response from our server. */
  audit: AuditResponse;
  /** Stored extracted values including saved corrections; the server computes audit inputs. */
  bill: ExtractedBill;
  /** Identifier of the original bill PDF or image. */
  documentId: string;
  /** Disables duplicate draft requests. */
  busy: boolean;
  /** Requests a draft without submitting it. */
  onLetter: () => void;
  /** Reopens document confirmation and invalidates the current audit and draft. */
  onCorrect: () => void;
}) {
  /** Expanded evidence panel, or null when all are collapsed. */
  const [open, setOpen] = useState<string | null>(null);
  /** Server-produced monetary verdict and evidence-backed findings. */
  const { verdict, findings } = audit;
  // Every issue is the insurer's (e.g. a line it paid $0 for): point the patient to the insurer.
  const insurerOnly = findings.length > 0 && findings.every((f) => f.contact === "insurer");
  /** Maps bill lines to server findings for inspection, without calculating flags. */
  const flaggedLines = new Map<number, Finding[]>();
  for (const finding of findings) {
    for (const source of finding.sources) {
      if (source.kind === "bill_line")
        flaggedLines.set(source.lineNumber, [
          ...(flaggedLines.get(source.lineNumber) ?? []),
          finding,
        ]);
    }
  }

  return (
    <section className="paper-flow space-y-8">
      {findings.length === 0 && (
        <div className="paper-case-heading">
          <span className="paper-badge">✓ Review complete</span>
        </div>
      )}
      <div className="flex justify-end">
        <button
          className="paper-source-button"
          disabled={busy}
          onClick={onCorrect}
        >
          Correct bill or EOB details
        </button>
      </div>
      <dl className="paper-summary">
        <div className="paper-stat">
          <dt>Total billed charges</dt>
          <dd>
            {verdict.totalBilledCents === null
              ? "—"
              : usd(verdict.totalBilledCents)}
          </dd>
          <small>Full charges, not necessarily what you owe</small>
        </div>
        <div className="paper-stat paper-stat-review">
          <dt>Amount under review</dt>
          <dd>{usd(verdict.questionedCents)}</dd>
          <small>Questioned charges, not confirmed savings</small>
        </div>
        <div className="paper-stat">
          <dt>Reduction offered</dt>
          <dd>
            {verdict.offeredCents === null ? "—" : usd(verdict.offeredCents)}
          </dd>
          <small>
            {verdict.offeredCents === null
              ? "No offer recorded"
              : "An offer is not a verified reduction"}
          </small>
        </div>
        <div className="paper-stat">
          <dt>Confirmed savings</dt>
          <dd>
            {verdict.confirmedCents === null
              ? "—"
              : usd(verdict.confirmedCents)}
          </dd>
          <small>
            {verdict.confirmedCents === null
              ? "No written reduction verified"
              : "Verified against written evidence"}
          </small>
        </div>
      </dl>
      <div className="paper-workspace">
        <div className="paper-findings">
          {findings.length > 0 ? (
            <>
              <h3>
                {findings.length} item{findings.length === 1 ? "" : "s"} to
                review
              </h3>
              <p className="paper-copy">
                Potential issues are things to ask about, not proven errors.
                Records searched:{" "}
                {audit.providers.join(" and ") || "No connected providers"}
                {recordsOriginLabel(audit.recordsOrigin)}.
              </p>
              {findings.map((finding, index) => (
                <article className="paper-finding" key={finding.id}>
                  <div className="paper-finding-title">
                    <h4>
                      {String(index + 1).padStart(2, "0")} · {finding.title}
                    </h4>
                    <span>{usd(finding.amountQuestionedCents)}</span>
                  </div>
                  <p className="paper-copy">{finding.ask}</p>
                  <button
                    className="paper-source-button"
                    aria-expanded={open === finding.id}
                    aria-controls={`evidence-${finding.id}`}
                    onClick={() =>
                      setOpen(open === finding.id ? null : finding.id)
                    }
                  >
                    {open === finding.id
                      ? "Hide evidence ↑"
                      : "Explanation & evidence →"}
                  </button>
                  {open === finding.id && (
                    <div
                      id={`evidence-${finding.id}`}
                      className="billless-finding-details"
                    >
                      <p className="paper-copy">{finding.explanation}</p>
                      <ul className="paper-evidence">
                        {finding.sources.map((source, sourceIndex) => (
                          <li key={sourceIndex}>
                            <p>{describeSource(source)}</p>
                            {source.kind === "bill_line" && (
                              <a
                                className="paper-text-button inline-flex items-center min-h-11"
                                href={`/api/documents/${source.documentId}/file#page=${source.provenance.page ?? 1}`}
                                target="_blank"
                                rel="noreferrer"
                              >
                                Open original bill · page{" "}
                                {source.provenance.page ?? 1} ↗
                              </a>
                            )}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </article>
              ))}
            </>
          ) : (
            <div className="paper-empty">
              <div className="paper-check" aria-hidden="true">
                ✓
              </div>
              <h3>No issues found in the checks we ran.</h3>
              <p className="paper-copy">
                Our supported checks did not flag this bill. This does not
                guarantee every charge is correct or that the balance cannot be
                reduced.
              </p>
              <div className="paper-evidence">
                Supported checks: duplicate charges, bill vs. EOB when
                available, and documentation gaps.
                <br />
                Records searched:{" "}
                {audit.providers.join(" and ") || "No connected providers"}
                {recordsOriginLabel(audit.recordsOrigin)}.
              </div>
              <a
                className="paper-source-button inline-flex items-center min-h-11"
                href={`/api/documents/${documentId}/file`}
                target="_blank"
                rel="noreferrer"
              >
                View original bill ↗
              </a>
            </div>
          )}
        </div>
        <aside className="paper-next" aria-label="Your next step">
          <p className="paper-eyebrow">YOUR NEXT STEP</p>
          <h3>
            {!findings.length
              ? "You still have options."
              : insurerOnly
                ? "Ask your insurer to review this claim."
                : "Ask the billing office to review these charges."}
          </h3>
          <p className="paper-copy">
            {!findings.length
              ? "Ask the hospital about its financial assistance policy or available payment plans. Eligibility and terms depend on the hospital."
              : insurerOnly
                ? "The provider billed what your EOB says, so this is for your insurer. Prepare a letter asking it to reprocess the claim or explain how to appeal. Billy can also call them."
                : "Prepare a dispute draft with the evidence and documentation requests attached."}
          </p>
          {findings.length > 0 && (
            <button
              className="paper-primary"
              disabled={busy}
              onClick={onLetter}
            >
              {busy ? "Preparing your draft…" : insurerOnly ? "Prepare my letter to the insurer →" : "Prepare my dispute draft →"}
            </button>
          )}
          <a
            className="paper-secondary"
            href={`/api/documents/${documentId}/file`}
            target="_blank"
            rel="noreferrer"
          >
            View original bill ↗
          </a>
          <p className="text-sm leading-relaxed text-[var(--paper-muted)]">
            Nothing is sent or agreed to for you. You review the draft and
            choose whether to send it yourself.
          </p>
        </aside>
      </div>
      <details>
        <summary className="paper-source-button py-3">
          Inspect document values
        </summary>
        <p className="paper-copy py-3">
          These values include your saved corrections. The audit uses your
          confirmed details. To fix a value, choose “Correct bill or EOB
          details.”
        </p>
        <div className="paper-table-wrap">
          <table className="paper-table">
            <caption>Extracted bill line items</caption>
            <thead>
              <tr>
                <th scope="col">Line</th>
                <th scope="col">Code</th>
                <th scope="col">Description as printed</th>
                <th scope="col" className="text-right">
                  Charge
                </th>
                <th scope="col">Review status</th>
              </tr>
            </thead>
            <tbody>
              {bill.lines.map((line, index) => {
                /** Original line number used only to locate the audit's source pointers. */
                const number = line.lineNumber.value ?? index + 1;
                return (
                  <tr key={index}>
                    <td>{number}</td>
                    <td className="font-mono">
                      {line.code.value ?? "Not printed"}
                    </td>
                    <td>{line.description.value}</td>
                    <td className="text-right tabular-nums">
                      {line.charge.value === null
                        ? "—"
                        : usd(line.charge.value)}
                    </td>
                    <td>
                      {flaggedLines.has(number) ? "Under review" : "No finding"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </details>
      <p className="paper-footer">
        Plain-language help, not legal or financial advice. Rules vary by state
        and plan.
      </p>
    </section>
  );
}

/**
 * Letter screen: click any paragraph to see its sources; download the PDF.
 *
 * @param props.draft - The finished draft.
 * @param props.onTrack - Opens the case screen (dispute letters only).
 * @returns The letter screen.
 */
function LetterScreen({
  draft,
  onTrack,
}: {
  draft: Draft;
  onTrack?: () => void;
}) {
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
      a.download =
        draft.kind === "dispute_letter"
          ? "dispute-letter.pdf"
          : "itemized-bill-request.pdf";
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

  return (
    <section className="paper-flow billless-letter-screen space-y-4">
      <div className="billless-document-card">
        <p className="text-xs text-[var(--paper-muted)]">
          {draft.author === "llm"
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
              <p>No facts from your documents in this paragraph.</p>
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
