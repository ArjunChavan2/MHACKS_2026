"use client";
/** @file Shared patient confirmation UI for intake and case arrivals (SPEC.md §4.2). No audit logic. */
import { useMemo, useState } from "react";
import type { IngestResponse } from "@/lib/cases/service";
import type { ExtractionResult } from "@/lib/extract/pipeline";
import type { Field } from "@/lib/types";
import { reviewItems } from "@/lib/extract/reviewProgress";
import { fieldLabel } from "@/lib/format";

/** One uploaded document as tracked in the browser. */
export interface DocState {
  /** Server response for the document. */
  ingest: IngestResponse;
  /** Patient corrections by field path. */
  corrections: Record<string, string | null>;
  /** Paths the patient confirmed as printed. */
  confirmedPaths: string[];
  /** Whether the patient acknowledged that printed totals don't add up. */
  ackTotals: boolean;
  /** Whether the server locked the confirmation. */
  confirmed: boolean;
  /** Messages that blocked the last confirmation attempt. */
  blocking: string[];
}

/**
 * Lists every field in an extraction with its path, in document order.
 *
 * @param r - Extraction result (bill or EOB).
 * @returns Path/field pairs; empty for unsupported documents.
 */
function listFields(r: ExtractionResult): Array<[string, Field<unknown>]> {
  const out: Array<[string, Field<unknown>]> = [];
  if (r.kind === "bill") {
    for (const [k, f] of Object.entries(r.bill.header))
      out.push([`header.${k}`, f]);
    r.bill.lines.forEach((l, i) =>
      Object.entries(l).forEach(([k, f]) =>
        out.push([`lines.${i}.${k}`, f as Field<unknown>]),
      ),
    );
  } else if (r.kind === "eob") {
    const { insurer, claimNumber, provider, totalPatientResponsibility } =
      r.eob;
    out.push(
      ["insurer", insurer],
      ["claimNumber", claimNumber],
      ["provider", provider],
      ["totalPatientResponsibility", totalPatientResponsibility],
    );
    r.eob.lines.forEach((l, i) =>
      Object.entries(l).forEach(([k, f]) =>
        out.push([`lines.${i}.${k}`, f as Field<unknown>]),
      ),
    );
  }
  return out;
}

/** Summarizes local review tasks for the action beside the confirmation button.
 * @param doc - Current editable bill/EOB state.
 * @returns Review counts across flagged fields and printed totals; server confirmation remains authoritative.
 */
export function confirmationProgress(doc: DocState) {
  const items = reviewItems(
    listFields(doc.ingest.result),
    doc.corrections,
    doc.confirmedPaths,
    doc.blocking,
  );
  const r = doc.ingest.result;
  const totals =
    r.kind === "bill"
      ? r.bill.documentIssues
      : r.kind === "eob"
        ? r.eob.documentIssues
        : [];
  const total = items.length + (totals.length > 0 ? 1 : 0);
  const remaining = doc.confirmed
    ? 0
    : items.filter((item) => !item.reviewed).length +
      (totals.length > 0 && !doc.ackTotals ? 1 : 0);
  return { total, remaining, reviewed: total - remaining };
}

/**
 * Confirm panel for one document: preview, flagged fields first, verified fields in one tap.
 *
 * @param props.title - Panel heading.
 * @param props.doc - Document state.
 * @param props.onChange - Updates the document state.
 * @returns The confirm panel.
 */
export default function ConfirmPanel({
  title,
  doc,
  onChange,
}: {
  title: string;
  doc: DocState;
  onChange: (d: DocState) => void;
}) {
  const fields = useMemo(
    () => listFields(doc.ingest.result),
    [doc.ingest.result],
  );
  const flagged = fields.filter(
    ([, f]) => f.verification === "needs_attention",
  );
  const verified = fields.filter(
    ([, f]) => f.verification !== "needs_attention",
  );
  const r = doc.ingest.result;
  const docIssues =
    r.kind === "bill"
      ? r.bill.documentIssues
      : r.kind === "eob"
        ? r.eob.documentIssues
        : [];
  const [showVerified, setShowVerified] = useState(false);
  const [previewPage, setPreviewPage] = useState(1);

  /** Local review tasks; edited values remain subject to server confirmation. */
  const items = reviewItems(
    fields,
    doc.corrections,
    doc.confirmedPaths,
    doc.blocking,
  );
  const pending = doc.confirmed ? [] : items.filter((item) => !item.reviewed);
  const totalsPending =
    !doc.confirmed && docIssues.length > 0 && !doc.ackTotals;
  const { total, remaining, reviewed } = confirmationProgress(doc);

  /** Stable field anchor per document; bill and EOB fields cannot collide. */
  function fieldId(path: string) {
    return `confirm-${doc.ingest.documentId}-${path}`;
  }

  /** Opens the field's section, shows its source page and focuses the unfinished input. */
  function goToField(path: string) {
    const field = fields.find(([key]) => key === path)?.[1];
    if (field?.page) setPreviewPage(field.page);
    if (!flagged.some(([key]) => key === path)) setShowVerified(true);
    requestAnimationFrame(() => {
      const input = document.getElementById(fieldId(path));
      input?.scrollIntoView({
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "instant"
          : "smooth",
        block: "center",
      });
      input?.focus({ preventScroll: true });
    });
  }

  /**
   * Records a correction for a field.
   *
   * @param path - Field path.
   * @param value - New raw value.
   */
  function correct(path: string, value: string) {
    onChange({
      ...doc,
      blocking: [],
      corrections: { ...doc.corrections, [path]: value },
    });
  }

  /**
   * Toggles "confirmed as printed" for a flagged field.
   *
   * @param path - Field path.
   */
  function toggleConfirm(path: string) {
    const has = doc.confirmedPaths.includes(path);
    onChange({
      ...doc,
      blocking: [],
      confirmedPaths: has
        ? doc.confirmedPaths.filter((p) => p !== path)
        : [...doc.confirmedPaths, path],
    });
  }

  return (
    <div className="billless-document-card">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">{title}</h2>
        {doc.confirmed && (
          <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800">
            Confirmed and locked
          </span>
        )}
      </div>
      <p className="mt-1 text-xs text-[var(--paper-muted)]">
        Compare these values with your document. Saved corrections are included;
        correct anything that was read incorrectly.
      </p>
      <div className="billless-confirm-progress">
        <div className="billless-confirm-progress-heading">
          <strong>
            {doc.confirmed
              ? "Details confirmed"
              : remaining
                ? `${remaining} ${remaining === 1 ? "item needs" : "items need"} review`
                : "Ready to confirm"}
          </strong>
          <span>
            {total
              ? `${reviewed} of ${total} review items checked`
              : "No flagged fields"}
          </span>
        </div>
        <p className="paper-copy" aria-live="polite">
          {pending.length
            ? `Next: ${fieldLabel(pending[0].path)}${pending[0].missing ? " — enter the value from your document." : " — check or correct this value."}`
            : totalsPending
              ? "Next: check the printed totals below."
              : doc.confirmed
                ? "Your confirmed details are saved."
                : "Submit below to validate these details. Edited values will be checked again."}
        </p>
        {totalsPending && pending.length === 0 && (
          <button
            className="paper-source-button"
            type="button"
            onClick={() => goToField("totals")}
          >
            Go to printed totals →
          </button>
        )}
        {pending.length > 0 && (
          <button
            className="paper-source-button"
            type="button"
            onClick={() => goToField(pending[0].path)}
          >
            Go to next unfinished field →
          </button>
        )}
        {pending.length > 1 && (
          <details>
            <summary>See all unfinished fields ({pending.length})</summary>
            <ul>
              {pending.map((item) => (
                <li key={item.path}>
                  <button
                    type="button"
                    className="paper-source-button"
                    onClick={() => goToField(item.path)}
                  >
                    {fieldLabel(item.path)}
                    {item.missing ? " · Value needed" : " · Check value"}
                  </button>
                </li>
              ))}
            </ul>
          </details>
        )}
        {docIssues.length > 0 && !doc.ackTotals && (
          <p className="paper-copy">
            Also check the printed totals below before confirming.
          </p>
        )}
      </div>
      <iframe
        title={`${title} preview`}
        src={`/api/documents/${doc.ingest.documentId}/file#page=${previewPage}`}
        className="mt-3 h-72 w-full rounded-md ring-1 ring-[var(--paper-border)]"
      />

      {docIssues.length > 0 && (
        <div className="mt-4 rounded-md bg-red-50 p-3 text-sm text-red-900 ring-1 ring-red-200">
          {docIssues.map((m) => (
            <p key={m}>{m}</p>
          ))}
          <label className="mt-2 flex items-start gap-2">
            <input
              type="checkbox"
              id={fieldId("totals")}
              disabled={doc.confirmed}
              checked={doc.ackTotals}
              onChange={(e) =>
                onChange({ ...doc, ackTotals: e.target.checked })
              }
            />
            <span>
              I checked the document: the printed totals themselves don&apos;t
              add up (this is how the bill is printed).
            </span>
          </label>
        </div>
      )}

      <h3 className="mt-5 text-sm font-semibold">
        Check these details ({flagged.length})
      </h3>
      {flagged.length === 0 && (
        <p className="text-sm text-[var(--paper-muted)]">Nothing flagged.</p>
      )}
      <ul className="mt-2 space-y-3">
        {flagged.map(([path, f]) => (
          <li
            key={path}
            className={`billless-confirm-field ${pending.some((item) => item.path === path) ? "is-pending" : "is-reviewed"}`}
          >
            <div className="flex items-center justify-between text-sm font-medium">
              <span>{fieldLabel(path)}</span>
              <span className="billless-field-state">
                {doc.confirmed
                  ? "Confirmed"
                  : pending.find((item) => item.path === path)?.missing
                    ? "Value needed"
                    : pending.some((item) => item.path === path)
                      ? "Check value"
                      : "Reviewed"}
              </span>
              {f.page && (
                <button
                  className="text-xs text-[var(--paper-muted)] underline"
                  onClick={() => setPreviewPage(f.page ?? 1)}
                >
                  page {f.page}
                </button>
              )}
            </div>
            <p id={`${fieldId(path)}-hint`} className="billless-field-hint">
              {pending.find((item) => item.path === path)?.missing
                ? "Enter the value shown on the document."
                : "Correct the value or confirm that it matches your document."}
            </p>
            {f.issues.map((m) => (
              <p key={m} className="text-xs text-amber-900">
                {m}
              </p>
            ))}
            {f.snippet && (
              <p className="mt-1 rounded bg-white px-2 py-1 font-mono text-xs text-[var(--paper-muted)]">
                “{f.snippet}”
              </p>
            )}
            <div className="billless-correction-row">
              <input
                className="min-w-0 flex-1 rounded border border-[var(--paper-border)] px-2 py-2 text-base"
                id={fieldId(path)}
                aria-label={`Correct ${fieldLabel(path)}`}
                aria-describedby={`${fieldId(path)}-hint`}
                aria-invalid={pending.some(
                  (item) =>
                    item.path === path &&
                    (item.missing || item.errors.length > 0),
                )}
                value={doc.corrections[path] ?? f.raw ?? ""}
                disabled={doc.confirmed}
                placeholder="[to confirm]"
                onChange={(e) => correct(path, e.target.value)}
              />
              <label className="flex items-center gap-1 text-xs">
                <input
                  type="checkbox"
                  disabled={doc.confirmed}
                  checked={doc.confirmedPaths.includes(path)}
                  onChange={() => toggleConfirm(path)}
                />{" "}
                matches the document
              </label>
            </div>
          </li>
        ))}
      </ul>

      <button
        className="paper-source-button mt-4"
        aria-expanded={showVerified}
        onClick={() => setShowVerified((s) => !s)}
      >
        {showVerified ? "Hide" : "Review"} {verified.length} document values
      </button>
      {showVerified && (
        <ul className="mt-2 divide-y divide-slate-100 text-sm">
          {verified.map(([path, f]) => (
            <li
              key={path}
              className={`billless-verified-row ${pending.some((item) => item.path === path) ? "billless-confirm-field is-pending" : ""}`}
            >
              <span className="text-[var(--paper-muted)]">
                {fieldLabel(path)}
              </span>
              <input
                id={fieldId(path)}
                aria-invalid={pending.some(
                  (item) =>
                    item.path === path &&
                    (item.missing || item.errors.length > 0),
                )}
                className="min-w-0 rounded border border-[var(--paper-border)] px-2 py-2 text-base"
                aria-label={`Correct ${fieldLabel(path)}`}
                value={doc.corrections[path] ?? f.raw ?? ""}
                disabled={doc.confirmed}
                onChange={(e) => correct(path, e.target.value)}
              />
            </li>
          ))}
        </ul>
      )}
      {doc.blocking.length > 0 && (
        <div className="mt-4 rounded-md bg-red-50 p-3 text-sm text-red-900 ring-1 ring-red-200">
          <p className="font-medium">
            Still needs fixing before we can check the bill:
          </p>
          {doc.blocking.map((m) => (
            <p key={m}>• {m}</p>
          ))}
        </div>
      )}
    </div>
  );
}
