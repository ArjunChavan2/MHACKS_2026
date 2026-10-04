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
import type { ImessageStatus } from "@/lib/messaging/service";
import { longDate, usd } from "@/lib/format";
import type { ExtractedBill, Finding } from "@/lib/types";
import CaseDocumentFlow from "./CaseDocumentFlow";
import CasePreferencesPanel from "./CasePreferencesPanel";
import type { CasePreferencesInput } from "@/lib/cases/preferences";
import { describeSource } from "./sources";

/** How often to refresh the case while the screen is open. */
const REFRESH_MS = 3000;

/** Actions this screen can run through `/api/cases/[id]/actions`. */
const RUNNABLE = new Set([
  "send_dispute",
  "request_document",
  "request_revised_statement",
  "follow_up",
  "patient_takes_over",
]);

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
  if (f.status === "withdrawn")
    return {
      label: "Withdrawn",
      cls: "bg-stone-100 text-stone-700 ring-stone-300",
    };
  if (f.status === "pending")
    return {
      label: "Pending",
      cls: "bg-amber-50 text-amber-900 ring-amber-200",
    };
  if (f.status === "confirmed") {
    return f.verified
      ? {
          label: "Confirmed and verified",
          cls: "bg-emerald-50 text-emerald-900 ring-emerald-200",
        }
      : {
          label: "Office confirmed; awaiting proof",
          cls: "bg-sky-50 text-sky-900 ring-sky-200",
        };
  }
  return {
    label: "Potential issue",
    cls: "bg-orange-50 text-orange-900 ring-orange-200",
  };
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
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message ?? "Request failed");
  return data as T;
}

/** Fetches a saved case; unavailable cases and network failures reach the visible retry state.
 * @param caseId - Saved case identifier, encoded as one URL segment.
 * @returns Server-computed case view; never derives clinical facts or workflow transitions.
 */
async function readCase(caseId: string): Promise<CaseView> {
  const res = await fetch(`/api/cases/${encodeURIComponent(caseId)}`, {
    cache: "no-store",
  });
  if (!res.ok)
    throw new Error(
      res.status === 404
        ? "This case couldn’t be found. Check the case link and try again."
        : "Your case couldn’t be loaded. Please try again.",
    );
  return (await res.json()) as CaseView;
}

/**
 * The case screen.
 *
 * @param props.caseId - Case to show.
 * @returns The case screen.
 */
export default function CaseScreen({ caseId }: { caseId: string }) {
  /** Explicit editor choices remain stable while polling refreshes the case. */
  const [preferences, setPreferences] = useState<CasePreferencesInput | null>(
    null,
  );
  const [view, setView] = useState<CaseView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [openCall, setOpenCall] = useState<string | null>(null);
  const [consentText, setConsentText] = useState("");
  const [imessage, setImessage] = useState<ImessageStatus | null>(null);

  /** Reloads the case after an action. */
  async function refresh() {
    setView(await readCase(caseId));
    setLoadError(null);
  }

  // Load now and every few seconds, so operator responses appear without a reload.
  useEffect(() => {
    let cancelled = false;
    const load = () =>
      readCase(caseId)
        .then((v) => {
          if (!cancelled) {
            setView(v);
            setLoadError(null);
          }
        })
        .catch((e: unknown) => {
          if (!cancelled)
            setLoadError(
              e instanceof Error
                ? e.message
                : "Your case couldn’t be loaded. Please try again.",
            );
        });
    const loadImessage = () =>
      fetch(`/api/cases/${encodeURIComponent(caseId)}/imessage`, {
        cache: "no-store",
      })
        .then((r) => (r.ok ? (r.json() as Promise<ImessageStatus>) : null))
        .then((m) => {
          if (!cancelled && m) setImessage(m);
        })
        .catch(() => undefined);
    load();
    loadImessage();
    const t = setInterval(() => {
      load();
      loadImessage();
    }, REFRESH_MS);
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
  /** Sends the typed consent phrase (demo stand-in for the iMessage reply). */
  async function giveConsent() {
    setBusy(true);
    setError(null);
    try {
      await post(`/api/cases/${caseId}/consent`, { text: consentText });
      setConsentText("");
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  /** Saves the agent's latest finished call (transcript as recorded) to this case. */
  async function addLatestCall() {
    setBusy(true);
    setError(null);
    try {
      await post(`/api/cases/${caseId}/calls`, {});
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  /**
   * Runs a server-allowed case action with explicit patient approval where required.
   * @param actionId - Action ID.
   * @param target - Task or document ID.
   * @param approve - True only for the patient's explicit approval button.
   * Side effects: invokes the guarded action and refreshes the case; errors remain visible.
   */
  async function act(
    actionId: string,
    target: string | undefined,
    approve: boolean,
  ) {
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
   * Saves the edited goal/restrictions before any subsequent contact action.
   * Side effects: persists choices and reloads server authorization; keeps editor on failure.
   */
  async function savePreferences() {
    if (!preferences) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/cases/${caseId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(preferences),
      });
      const data = await response.json();
      if (!response.ok)
        throw new Error(data.message ?? "Your choices could not be saved.");
      await refresh();
      setPreferences(null);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Your choices could not be saved.",
      );
    } finally {
      setBusy(false);
    }
  }

  /** Retries a failed lookup without discarding an already loaded case. */
  async function retry() {
    setBusy(true);
    try {
      await refresh();
    } catch (e) {
      setLoadError(
        e instanceof Error
          ? e.message
          : "Your case couldn’t be loaded. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  if (!view)
    return (
      <section
        className="paper-flow billless-load-state"
        aria-busy={!loadError || busy}
      >
        <p className="paper-eyebrow">YOUR CASE</p>
        <h2>{loadError ? "Let’s find your case" : "Opening your case…"}</h2>
        <p className="paper-copy" role={loadError ? "alert" : "status"}>
          {loadError ??
            "Loading your next step, documents and recorded updates."}
        </p>
        {loadError && (
          <button
            className="paper-primary"
            disabled={busy || Boolean(preferences)}
            onClick={retry}
          >
            {busy ? "Trying again…" : "Try again"}
          </button>
        )}
      </section>
    );
  const s = view.state;
  const findings = view.audit?.findings ?? [];
  const next = s.next;
  const revisedDoc =
    next.actionId === "confirm_revised_statement"
      ? view.documents.find((d) => d.ingest.documentId === next.target)
      : undefined;
  const revisedBill =
    revisedDoc?.ingest.result.kind === "bill"
      ? (revisedDoc.ingest.result.bill as ExtractedBill)
      : null;
  const extraActions = s.allowed.filter(
    (a) =>
      RUNNABLE.has(a.id) &&
      a.id !== "patient_takes_over" &&
      !(a.id === next.actionId && a.target === next.target),
  );

  return (
    <section className="paper-flow billless-case-screen space-y-6">
      <div className="paper-case-heading">
        <div className="paper-page-heading">
          <p className="paper-eyebrow">YOUR CASE</p>
          <h2>{PHASE_LABEL[s.phase]}</h2>
          <p>
            Every change below comes from a recorded response or a document,
            with its source attached.
          </p>
        </div>
        <span
          className={`paper-badge ${s.phase === "resolved" ? "" : "paper-review-badge"}`}
        >
          {PHASE_LABEL[s.phase]}
        </span>
      </div>

      {loadError && (
        <div className="billless-refresh-warning" role="alert">
          <p>{loadError} The last loaded update is shown below.</p>
          <button
            className="paper-source-button"
            disabled={busy || Boolean(preferences)}
            onClick={retry}
          >
            Retry
          </button>
        </div>
      )}

      {error && (
        <p
          role="alert"
          className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800 ring-1 ring-red-200"
        >
          {error}
        </p>
      )}

      <section
        className="billless-document-card space-y-3"
        aria-label="Your saved goal and choices"
      >
        <h3 className="text-lg font-semibold">Your goal and choices</h3>
        <p className="paper-copy">
          {s.preferences.goal ?? "No goal saved yet."}
        </p>
        <p className="paper-copy">
          {s.preferences.noPayments
            ? "Don’t agree to any payments. "
            : "Payment agreements aren’t available in this demo. "}
          {s.preferences.pauseContact
            ? "Contact is on hold."
            : "Every contact needs your approval."}
        </p>
        {preferences ? (
          <>
            <CasePreferencesPanel
              value={preferences}
              disabled={busy}
              onChange={setPreferences}
            />
            <p className="paper-copy">
              Save your changes before continuing with contact actions.
            </p>
            <button
              className="paper-primary"
              disabled={busy || !preferences.goal.trim()}
              onClick={savePreferences}
            >
              {busy ? "Saving…" : "Save my choices"}
            </button>
            <button
              className="paper-secondary"
              disabled={busy}
              onClick={() => setPreferences(null)}
            >
              Cancel changes
            </button>
          </>
        ) : (
          <button
            className="paper-secondary"
            disabled={busy}
            onClick={() =>
              setPreferences({
                goal: s.preferences.goal ?? "Review my medical bill",
                noPayments: s.preferences.noPayments,
                pauseContact: s.preferences.pauseContact,
              })
            }
          >
            Edit my choices
          </button>
        )}
      </section>
      {s.consent?.pendingRequest && (
        <section
          className="rounded-xl bg-amber-50 p-4 ring-2 ring-amber-300"
          aria-live="assertive"
        >
          <p className="paper-eyebrow">BILLY NEEDS YOU ON A LIVE CALL</p>
          <h3 className="mt-1 text-lg font-semibold">
            The billing office needs your consent
          </h3>
          <p className="paper-copy text-sm">
            Billy is on the phone and the office needs to know you agree to him
            representing you. Reply by iMessage, or type the phrase here
            exactly:
          </p>
          <p className="my-2 font-mono text-sm font-semibold">
            I consent to Billy representing me
          </p>
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void giveConsent();
            }}
          >
            <input
              value={consentText}
              onChange={(e) => setConsentText(e.target.value)}
              className="flex-1 rounded-md bg-white px-3 py-2 ring-1 ring-[var(--paper-border)]"
              aria-label="Consent phrase"
              placeholder="I consent to Billy representing me"
            />
            <button
              className="paper-primary"
              disabled={busy || !consentText.trim()}
              type="submit"
            >
              Send
            </button>
          </form>
          <p className="mt-2 text-xs text-[var(--paper-muted)]">
            Demo only: typed consent stands in for identity verification.
          </p>
        </section>
      )}
      {!s.consent?.pendingRequest && s.consent?.givenAt && (
        <p className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-900 ring-1 ring-emerald-200">
          You consented to Billy representing you (
          {s.consent.via === "imessage" ? "by iMessage" : "on the web"}).
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
              <dt className="inline font-semibold">
                {next.overdue ? "Was due: " : "Expected by: "}
              </dt>
              <dd
                className={`inline ${next.overdue ? "font-semibold text-red-700" : ""}`}
              >
                {deadlineText(next.deadline)}
                {next.overdue ? " (overdue)" : ""}
              </dd>
            </div>
          )}
        </dl>
        {RUNNABLE.has(next.actionId) && (
          <button
            className="paper-primary"
            disabled={busy || Boolean(preferences)}
            onClick={() => act(next.actionId, next.target, next.needsApproval)}
          >
            {busy
              ? "Working…"
              : next.needsApproval && !next.title.startsWith("Approve")
                ? `Approve: ${next.title}`
                : next.title}
          </button>
        )}
        {next.needsApproval && RUNNABLE.has(next.actionId) && (
          <p className="mt-2 text-xs text-[var(--paper-muted)]">
            Your approval is recorded on the case. Sending is simulated in this
            demo.
          </p>
        )}
        {revisedDoc && revisedBill && (
          <div className="mt-3 space-y-2 rounded-md bg-white p-3 text-sm ring-1 ring-[var(--paper-border)]">
            <p className="font-semibold">Revised statement as printed</p>
            <ul className="space-y-1 font-mono text-xs">
              {revisedBill.lines.map((l, i) => (
                <li key={i}>
                  {l.lineNumber.raw} · {l.code.raw} · {l.description.raw} ·{" "}
                  {l.charge.raw}
                </li>
              ))}
            </ul>
            <p>
              Amount due:{" "}
              <strong>{revisedBill.header.amountDue.raw ?? "not shown"}</strong>
            </p>
            <a
              className="paper-source-button inline-flex items-center"
              href={`/api/documents/${revisedDoc.ingest.documentId}/file`}
              target="_blank"
              rel="noreferrer"
            >
              View the statement ↗
            </a>
            <button
              className="paper-primary"
              disabled={busy || Boolean(preferences)}
              onClick={() =>
                document
                  .getElementById("case-document-flow")
                  ?.scrollIntoView({ behavior: "smooth" })
              }
            >
              Review and confirm below
            </button>
          </div>
        )}
        {extraActions.length > 0 && (
          <details className="billless-other-actions">
            <summary>Other options</summary>
            {extraActions.map((a) => (
              <button
                key={`${a.id}-${a.target ?? ""}`}
                className="paper-secondary mt-2"
                disabled={busy || Boolean(preferences)}
                onClick={() => act(a.id, a.target, a.needsApproval)}
              >
                {a.needsApproval ? `Approve: ${a.label}` : a.label}
              </button>
            ))}
          </details>
        )}
      </aside>

      {imessage && (
        <aside
          className="rounded-md bg-white p-4 text-sm ring-1 ring-[var(--paper-border)]"
          aria-label="iMessage updates"
        >
          <p className="paper-eyebrow">IMESSAGE UPDATES</p>
          {imessage.linked ? (
            <p className="mt-1">
              <strong>Linked to iMessage.</strong> You&apos;ll get a text when
              this case needs you. Reply A to approve, B to hold, WHY for the
              evidence, or STOP to turn texts off.
            </p>
          ) : (
            <p className="mt-1">
              Text <strong className="font-mono">LINK {imessage.code}</strong>{" "}
              to{" "}
              {imessage.photonNumber ? (
                <strong>{imessage.photonNumber}</strong>
              ) : (
                "the BillLess iMessage number"
              )}{" "}
              to get updates and approve steps by text.
            </p>
          )}
        </aside>
      )}

      {s.savings && (
        <dl className="paper-summary">
          <div className="paper-stat paper-stat-review">
            <dt>Still in question</dt>
            <dd>{usd(s.savings.questionedCents)}</dd>
            <small>Questioned charges, not savings</small>
          </div>
          <div className="paper-stat">
            <dt>Reduction offered</dt>
            <dd>
              {s.savings.offeredCents ? usd(s.savings.offeredCents) : "—"}
            </dd>
            <small>
              {s.savings.offeredCents
                ? "Agreed, not yet on a revised bill"
                : "No offer recorded"}
            </small>
          </div>
          <div className="paper-stat">
            <dt>Confirmed savings</dt>
            <dd>
              {s.savings.confirmedCents === null
                ? "—"
                : usd(s.savings.confirmedCents)}
            </dd>
            <small>
              {s.savings.confirmedCents === null
                ? "Needs a revised statement"
                : "Verified on the revised statement"}
            </small>
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
                <span
                  className={`rounded-full px-2 py-0.5 text-xs ring-1 ${chip.cls}`}
                >
                  {chip.label}
                </span>
              </div>
              {f.statusNote && (
                <p className="paper-copy font-medium">{f.statusNote}</p>
              )}
              <p className="paper-copy">{f.explanation}</p>
              <button
                type="button"
                className="paper-source-button"
                aria-expanded={open === f.id}
                onClick={() => setOpen(open === f.id ? null : f.id)}
              >
                {open === f.id ? "Hide evidence" : "Show evidence"}
              </button>
              {open === f.id && (
                <ul className="paper-evidence font-mono text-xs">
                  {sources.map((src, i) => (
                    <li key={i}>
                      {src.kind === "document" ? (
                        <a
                          className="underline"
                          href={`/api/documents/${src.documentId}/file`}
                          target="_blank"
                          rel="noreferrer"
                        >
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
                  <span className="text-xs">
                    {t.status === "open"
                      ? "Open"
                      : t.status === "done"
                        ? "Received"
                        : "You're handling this"}
                  </span>
                </div>
                <p className="paper-copy">
                  From: {t.responsibleParty}
                  {t.followUpDate
                    ? ` · follow up ${longDate(t.followUpDate)}`
                    : " · no date given"}
                </p>
                {t.status === "open" && (
                  <button
                    className="paper-source-button"
                    disabled={busy || Boolean(preferences)}
                    onClick={() => act("patient_takes_over", t.id, false)}
                  >
                    I&apos;ll do this myself
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {!preferences && (
        <div id="case-document-flow">
          <CaseDocumentFlow
            view={view}
            onUpdated={refresh}
            onBusyChange={setBusy}
          />
        </div>
      )}
      <section
        className="billless-document-card space-y-3"
        aria-label="Case documents"
      >
        <h3 className="text-lg font-semibold">Case documents</h3>
        <ul className="space-y-3">
          {view.documents.map((d) => (
            <li
              key={d.ingest.documentId}
              className="billless-case-document-row"
            >
              <a
                className="underline"
                href={`/api/documents/${d.ingest.documentId}/file`}
                target="_blank"
                rel="noreferrer"
              >
                {d.fileName ?? "Received document"}
              </a>
              <span>
                {d.ingest.result.kind === "bill" &&
                d.ingest.result.bill.docType === "revised_statement"
                  ? "Revised statement · "
                  : ""}
                {d.confirmed ? "Confirmed" : "Needs confirmation"}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <div className="paper-findings">
        <h3>Calls</h3>
        <p className="paper-copy text-sm">
          Transcripts exactly as the voice assistant recorded them. Synthetic
          demo calls.
        </p>
        {(s.calls ?? []).length === 0 && (
          <p className="paper-copy text-sm">No calls saved to this case yet.</p>
        )}
        <ul className="space-y-2">
          {[...(s.calls ?? [])].reverse().map((call) => (
            <li key={call.conversationId} className="paper-finding">
              <div className="paper-finding-title">
                <strong>
                  {new Date(call.startedAt).toLocaleString([], {
                    month: "short",
                    day: "numeric",
                    hour: "numeric",
                    minute: "2-digit",
                  })}{" "}
                  · {Math.floor(call.durationSecs / 60)}:
                  {String(call.durationSecs % 60).padStart(2, "0")}
                </strong>
                <span className="text-xs">{call.transcript.length} turns</span>
              </div>
              {call.endedBy && (
                <p className="paper-copy text-xs">Ended: {call.endedBy}</p>
              )}
              <button
                type="button"
                className="paper-source-button"
                aria-expanded={openCall === call.conversationId}
                onClick={() =>
                  setOpenCall(
                    openCall === call.conversationId
                      ? null
                      : call.conversationId,
                  )
                }
              >
                {openCall === call.conversationId
                  ? "Hide transcript"
                  : "Show transcript"}
              </button>
              {openCall === call.conversationId && (
                <ol className="mt-2 space-y-1 text-sm">
                  {call.transcript.map((turn, i) => (
                    <li key={i} className="flex gap-2">
                      <span className="shrink-0 font-mono text-xs text-[var(--paper-muted)]">
                        {turn.atSecs}s
                      </span>
                      <span>
                        <strong>
                          {turn.role === "agent"
                            ? "Assistant"
                            : "Billing office"}
                          :
                        </strong>{" "}
                        {turn.message}
                      </span>
                    </li>
                  ))}
                </ol>
              )}
            </li>
          ))}
        </ul>
        <button
          className="paper-secondary mt-2"
          disabled={busy || Boolean(preferences)}
          onClick={addLatestCall}
        >
          Add the latest call to this case
        </button>
      </div>

      <div className="paper-findings">
        <h3>Timeline</h3>
        <ol className="billless-timeline">
          {[...s.timeline].reverse().map((e, i) => (
            <li key={i} className="billless-timeline-event">
              <time
                className="shrink-0 font-mono text-xs text-[var(--paper-muted)]"
                dateTime={e.at}
              >
                {new Date(e.at).toLocaleString([], {
                  month: "short",
                  day: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                })}
              </time>
              <span>{e.summary}</span>
            </li>
          ))}
        </ol>
      </div>

      <p className="text-center text-xs text-[var(--paper-muted)]">
        Case ID: <code>{caseId}</code> · Nothing is sent for real in this demo;
        sends are recorded as simulated.
      </p>
    </section>
  );
}
