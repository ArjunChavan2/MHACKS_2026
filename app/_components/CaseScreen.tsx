"use client";
/**
 * @file The patient's case screen (SPEC.md §3.9, §4.6–4.7, §6 MVP 2).
 *
 * Shows the "What happens next?" card, findings with their status and evidence, the savings trio
 * (questioned / offered / confirmed), tasks, documents, and the timeline. Everything comes from
 * `GET /api/cases/[id]` (`view.state`); this screen never computes phase, savings, or card text.
 * Actions that contact someone are sent with `approve: true` only from an explicit button press.
 * Refreshes every few seconds so responses recorded in the operator console appear live.
 */
import { useEffect, useState } from "react";
import type { CaseState } from "@/lib/cases/caseflow";
import type { CaseView } from "@/lib/cases/service";
import { longDate, usd } from "@/lib/format";
import type { ExtractedBill, Finding } from "@/lib/types";
import { describeSource } from "./sources";

/** How often to refresh the case while the screen is open. */
const REFRESH_MS = 3000;

/** Actions this screen can run through `/api/cases/[id]/actions`. */
const RUNNABLE = new Set(["send_dispute", "request_document", "request_revised_statement", "follow_up", "patient_takes_over"]);

/** Plain labels for each phase. */
const PHASE_LABEL: Record<CaseState["phase"], string> = {
  intake: "Getting started",
  audited: "Checked",
  awaiting_approval: "Needs your approval",
  waiting_response: "Waiting for a response",
  waiting_document: "Waiting for a document",
  verifying: "Checking a revised statement",
  resolved: "Resolved",
};

/**
 * Plain label and color for a finding's status.
 *
 * @param f - Finding.
 * @returns Label and Tailwind classes.
 */
function statusChip(f: Finding): { label: string; cls: string } {
  if (f.status === "withdrawn") return { label: "Withdrawn", cls: "bg-stone-100 text-stone-700 ring-stone-300" };
  if (f.status === "pending") return { label: "Pending", cls: "bg-amber-50 text-amber-900 ring-amber-200" };
  if (f.status === "confirmed") {
    return f.verified
      ? { label: "Confirmed and verified", cls: "bg-emerald-50 text-emerald-900 ring-emerald-200" }
      : { label: "Office confirmed; awaiting proof", cls: "bg-sky-50 text-sky-900 ring-sky-200" };
  }
  return { label: "Potential issue", cls: "bg-orange-50 text-orange-900 ring-orange-200" };
}

/**
 * Formats a deadline for the card.
 *
 * @param d - Date, "unconfirmed", or null.
 * @returns Text, or null when there is no deadline.
 */
function deadlineText(d: CaseState["next"]["deadline"]): string | null {
  if (!d) return null;
  return d === "unconfirmed" ? "No date given yet" : longDate(d);
}

/**
 * Posts JSON and returns the parsed reply, throwing the server's message on failure.
 *
 * @param url - API route.
 * @param body - JSON body.
 * @returns Parsed JSON.
 */
async function post<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message ?? "Request failed");
  return data as T;
}

/**
 * The case screen.
 *
 * @param props.caseId - Case to show.
 * @returns The case screen.
 */
export default function CaseScreen({ caseId }: { caseId: string }) {
  const [view, setView] = useState<CaseView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  /** Reloads the case after an action. */
  async function refresh() {
    const res = await fetch(`/api/cases/${caseId}`, { cache: "no-store" });
    if (res.ok) setView((await res.json()) as CaseView);
  }

  // Load now and every few seconds, so operator responses appear without a reload.
  useEffect(() => {
    let cancelled = false;
    const load = () =>
      fetch(`/api/cases/${caseId}`, { cache: "no-store" })
        .then((r) => (r.ok ? (r.json() as Promise<CaseView>) : null))
        .then((v) => {
          if (!cancelled && v) setView(v);
        })
        .catch(() => undefined);
    load();
    const t = setInterval(load, REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [caseId]);

  /**
   * Runs a case action. `approve` is true only for the patient's explicit approve button.
   *
   * @param actionId - Action.
   * @param target - Task or document ID.
   * @param approve - Whether this press is the approval.
   */
  async function act(actionId: string, target: string | undefined, approve: boolean) {
    setBusy(true);
    setError(null);
    try {
      await post(`/api/cases/${caseId}/actions`, { actionId, target, approve });
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  /**
   * Confirms the revised statement as printed (the patient checked the values shown).
   *
   * @param documentId - Revised statement document.
   * @param attention - Paths the patient is confirming as printed.
   */
  async function confirmRevised(documentId: string, attention: string[]) {
    setBusy(true);
    setError(null);
    try {
      const r = await post<{ ok: boolean; blocking?: string[] }>(`/api/documents/${documentId}/confirm`, { corrections: {}, confirmedPaths: attention, acknowledgeTotalsMismatch: false });
      if (!r.ok) setError(`This statement can't be confirmed as printed: ${(r.blocking ?? []).join("; ")}`);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (!view) return <p className="paper-copy">Loading your case…</p>;
  const s = view.state;
  const findings = view.audit?.findings ?? [];
  const next = s.next;
  const revisedDoc = next.actionId === "confirm_revised_statement" ? view.documents.find((d) => d.ingest.documentId === next.target) : undefined;
  const revisedBill = revisedDoc?.ingest.result.kind === "bill" ? (revisedDoc.ingest.result.bill as ExtractedBill) : null;
  const extraActions = s.allowed.filter((a) => RUNNABLE.has(a.id) && a.id !== "patient_takes_over" && !(a.id === next.actionId && a.target === next.target));

  return (
    <section className="paper-flow space-y-6">
      <div className="paper-case-heading">
        <div className="paper-page-heading">
          <p className="paper-eyebrow">YOUR CASE</p>
          <h2>{PHASE_LABEL[s.phase]}</h2>
          <p>Every change below comes from a recorded response or a document, with its source attached.</p>
        </div>
        <span className={`paper-badge ${s.phase === "resolved" ? "" : "paper-review-badge"}`}>{PHASE_LABEL[s.phase]}</span>
      </div>

      {error && (
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800 ring-1 ring-red-200">
          {error}
        </p>
      )}

      <aside className="paper-next" aria-label="What happens next">
        <p className="paper-eyebrow">WHAT HAPPENS NEXT?</p>
        <h3>{next.title}</h3>
        <p className="paper-copy">{next.why}</p>
        <dl className="mt-3 grid gap-1 text-sm">
          {next.needed && (
            <div>
              <dt className="inline font-semibold">Needed: </dt>
              <dd className="inline">{next.needed}</dd>
            </div>
          )}
          <div>
            <dt className="inline font-semibold">Who acts next: </dt>
            <dd className="inline">{next.responsibleParty}</dd>
          </div>
          {deadlineText(next.deadline) && (
            <div>
              <dt className="inline font-semibold">{next.overdue ? "Was due: " : "Expected by: "}</dt>
              <dd className={`inline ${next.overdue ? "font-semibold text-red-700" : ""}`}>
                {deadlineText(next.deadline)}
                {next.overdue ? " (overdue)" : ""}
              </dd>
            </div>
          )}
        </dl>
        {RUNNABLE.has(next.actionId) && (
          <button className="paper-primary" disabled={busy} onClick={() => act(next.actionId, next.target, next.needsApproval)}>
            {busy ? "Working…" : next.needsApproval && !next.title.startsWith("Approve") ? `Approve: ${next.title}` : next.title}
          </button>
        )}
        {next.needsApproval && RUNNABLE.has(next.actionId) && (
          <p className="mt-2 text-xs text-[var(--paper-muted)]">Your approval is recorded on the case. Sending is simulated in this demo.</p>
        )}
        {revisedDoc && revisedBill && (
          <div className="mt-3 space-y-2 rounded-md bg-white p-3 text-sm ring-1 ring-[var(--paper-border)]">
            <p className="font-semibold">Revised statement as printed</p>
            <ul className="space-y-1 font-mono text-xs">
              {revisedBill.lines.map((l, i) => (
                <li key={i}>
                  {l.lineNumber.raw} · {l.code.raw} · {l.description.raw} · {l.charge.raw}
                </li>
              ))}
            </ul>
            <p>
              Amount due: <strong>{revisedBill.header.amountDue.raw ?? "not shown"}</strong>
            </p>
            <a className="paper-source-button inline-flex items-center" href={`/api/documents/${revisedDoc.ingest.documentId}/file`} target="_blank" rel="noreferrer">
              View the statement ↗
            </a>
            <button className="paper-primary" disabled={busy} onClick={() => confirmRevised(revisedDoc.ingest.documentId, revisedDoc.ingest.attention)}>
              These values match my statement
            </button>
          </div>
        )}
        {extraActions.map((a) => (
          <button key={`${a.id}-${a.target ?? ""}`} className="paper-secondary mt-2" disabled={busy} onClick={() => act(a.id, a.target, a.needsApproval)}>
            {a.needsApproval ? `Approve: ${a.label}` : a.label}
          </button>
        ))}
      </aside>

      {s.savings && (
        <dl className="paper-summary">
          <div className="paper-stat paper-stat-review">
            <dt>Still in question</dt>
            <dd>{usd(s.savings.questionedCents)}</dd>
            <small>Questioned charges, not savings</small>
          </div>
          <div className="paper-stat">
            <dt>Reduction offered</dt>
            <dd>{s.savings.offeredCents ? usd(s.savings.offeredCents) : "—"}</dd>
            <small>{s.savings.offeredCents ? "Agreed, not yet on a revised bill" : "No offer recorded"}</small>
          </div>
          <div className="paper-stat">
            <dt>Confirmed savings</dt>
            <dd>{s.savings.confirmedCents === null ? "—" : usd(s.savings.confirmedCents)}</dd>
            <small>{s.savings.confirmedCents === null ? "Needs a revised statement" : "Verified on the revised statement"}</small>
          </div>
        </dl>
      )}

      <div className="paper-findings">
        <h3>Issues on this bill</h3>
        {findings.map((f) => {
          const chip = statusChip(f);
          const sources = [...(f.statusSources ?? []), ...f.sources];
          return (
            <article key={f.id} className="paper-finding">
              <div className="paper-finding-title">
                <strong>{f.title}</strong>
                <span className={`rounded-full px-2 py-0.5 text-xs ring-1 ${chip.cls}`}>{chip.label}</span>
              </div>
              {f.statusNote && <p className="paper-copy font-medium">{f.statusNote}</p>}
              <p className="paper-copy">{f.explanation}</p>
              <button type="button" className="paper-source-button" aria-expanded={open === f.id} onClick={() => setOpen(open === f.id ? null : f.id)}>
                {open === f.id ? "Hide evidence" : "Show evidence"}
              </button>
              {open === f.id && (
                <ul className="paper-evidence font-mono text-xs">
                  {sources.map((src, i) => (
                    <li key={i}>
                      {src.kind === "document" ? (
                        <a className="underline" href={`/api/documents/${src.documentId}/file`} target="_blank" rel="noreferrer">
                          {describeSource(src)} ↗
                        </a>
                      ) : (
                        describeSource(src)
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </article>
          );
        })}
      </div>

      {s.tasks.length > 0 && (
        <div className="paper-findings">
          <h3>Paperwork we&apos;re tracking</h3>
          <ul className="space-y-2">
            {s.tasks.map((t) => (
              <li key={t.id} className="paper-finding">
                <div className="paper-finding-title">
                  <strong>{t.documentNeeded}</strong>
                  <span className="text-xs">{t.status === "open" ? "Open" : t.status === "done" ? "Received" : "You're handling this"}</span>
                </div>
                <p className="paper-copy">
                  From: {t.responsibleParty}
                  {t.followUpDate ? ` · follow up ${longDate(t.followUpDate)}` : " · no date given"}
                </p>
                {t.status === "open" && (
                  <button className="paper-source-button" disabled={busy} onClick={() => act("patient_takes_over", t.id, false)}>
                    I&apos;ll do this myself
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="paper-findings">
        <h3>Timeline</h3>
        <ol className="space-y-1 text-sm">
          {[...s.timeline].reverse().map((e, i) => (
            <li key={i} className="flex gap-3">
              <time className="shrink-0 font-mono text-xs text-[var(--paper-muted)]" dateTime={e.at}>
                {new Date(e.at).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
              </time>
              <span>{e.summary}</span>
            </li>
          ))}
        </ol>
      </div>

      <p className="text-center text-xs text-[var(--paper-muted)]">
        Case ID: <code>{caseId}</code> · Nothing is sent for real in this demo; sends are recorded as simulated.
      </p>
    </section>
  );
}
