"use client";
/** @file Pre-call approval, live status/transcript and patient outcome review. No browser-derived findings or implicit commitments. */
import { useEffect, useRef, useState } from "react";
import type { ConsentState } from "@/lib/cases/consent";
import {
  FINISHED_CALL_STATES,
  type CallOutcome,
  type CallReview,
  type CallSession,
  type CallWorkspaceView,
} from "@/lib/calls/workspace-types";

/** Patient-readable provider states; a requested transfer does not claim a successful connection. */
const STATUS: Record<CallSession["status"], string> = {
  prepared: "Approved plan · ready to start",
  starting: "Requesting call",
  queued: "Queued",
  ringing: "Ringing",
  "in-progress": "Call in progress",
  completed: "Call ended",
  busy: "Office line busy",
  failed: "Call could not be confirmed",
  "no-answer": "No answer",
  canceled: "Canceled",
  handed_back: "Handed back to you",
  transfer_requested: "Patient transfer requested · connection unconfirmed",
};

/**
 * Patient workspace with exact disclosure review, provider polling and saved original-turn outcome references.
 * @param props - Existing case, current consent request, saved preferences status and parent refresh.
 * @returns Three connected screen panels; synthetic rehearsal never sends a provider request.
 */
export default function CallWorkspace({
  caseId,
  consent,
  disabled,
  onChange,
}: {
  caseId: string;
  consent: ConsentState;
  disabled: boolean;
  onChange: () => Promise<void>;
}) {
  /** Last server-derived case-bound workspace; displayed facts are never inferred in the browser. */
  const [view, setView] = useState<CallWorkspaceView | null>(null);
  /** Explicit selected session, retained across server refreshes. */
  const [sessionId, setSessionId] = useState<string | null>(null);
  /** Current patient panel; changing panels has no provider side effects. */
  const [screen, setScreen] = useState<"review" | "live" | "outcome">("review");
  /** Rehearsal is the default and never initiates external contact. */
  const [mode, setMode] = useState<"live" | "rehearsal">("rehearsal");
  /** Editable administrative plan; numbers are synthetic until the patient chooses live mode. */
  const [review, setReview] = useState<CallReview>({
    recipient: "Synthetic billing office",
    phone: "+15555550100",
    patientPhone: "+15555550101",
    purpose: "Request written billing information",
    disclosures: [],
  });
  /** Unchecked explicit local consent; any plan edit invalidates this checkbox. */
  const [approved, setApproved] = useState(false);
  /** Holds duplicate patient mutations while a request settles. */
  const [busy, setBusy] = useState(false);
  /** Safe visible failure; never substitutes a completed provider state. */
  const [error, setError] = useState<string | null>(null);
  /** Patient-entered phrase for the separate representation request. */
  const [consentText, setConsentText] = useState("");
  /** Timer-driven display clock for deadlines, never used to infer patient consent. */
  const [now, setNow] = useState(() => Date.now());
  /** Stops background polling after three provider failures; explicit controls remain available. */
  const [pausedSessionId, setPausedSessionId] = useState<string | null>(null);
  /** Failure count belongs to one selected session and survives its refreshed snapshots. */
  const pollFailures = useRef({ id: "", count: 0 });
  /** Immediate guard prevents duplicate requests before React updates the disabled controls. */
  const lock = useRef(false);
  /** Selected immutable server snapshot; arbitrary provider IDs cannot be supplied here. */
  const session = view?.sessions.find((s) => s.id === sessionId) ?? null;

  /** Reloads snapshots without starting contact; selected session survives refresh. */
  async function load() {
    const response = await fetch(`/api/cases/${caseId}/call-workspace`, {
      cache: "no-store",
    });
    const data = await response.json();
    if (!response.ok)
      throw new Error(data.message ?? "Call workspace could not be loaded.");
    setView(data);
    return data as CallWorkspaceView;
  }
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/cases/${caseId}/call-workspace`, { cache: "no-store" })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok)
          throw new Error(
            data.message ?? "Call workspace could not be restored.",
          );
        if (cancelled) return;
        setView(data);
        const latest = (data as CallWorkspaceView).sessions.at(-1);
        if (latest) {
          setSessionId(latest.id);
          setScreen(
            latest.status === "prepared"
              ? "review"
              : FINISHED_CALL_STATES.has(latest.status)
                ? "outcome"
                : "live",
          );
        }
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [caseId]);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (pausedSessionId === session?.id) return;
    if (!session || session.mode !== "live" || !session.sid || session.record)
      return;
    let cancelled = false;
    let polling = false;
    const timer = setInterval(async () => {
      if (polling || lock.current) return;
      polling = true;
      try {
        const response = await fetch(`/api/cases/${caseId}/call-workspace`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "refresh", sessionId: session.id }),
        });
        const data = await response.json();
        if (!response.ok)
          throw new Error(data.message ?? "Status refresh failed.");
        if (pollFailures.current.id !== session.id)
          pollFailures.current = { id: session.id, count: 0 };
        pollFailures.current.count = data.error
          ? pollFailures.current.count + 1
          : 0;
        if (!cancelled && pollFailures.current.count >= 3) {
          setPausedSessionId(session.id);
          setError(
            "Automatic status updates paused after repeated provider failures. The call may still be active. Use Refresh, End call or contact the office yourself.",
          );
        }
        if (!cancelled)
          setView((v) =>
            v
              ? {
                  ...v,
                  sessions: v.sessions.map((s) =>
                    s.id === data.id ? data : s,
                  ),
                }
              : v,
          );
      } catch (e) {
        if (pollFailures.current.id !== session.id)
          pollFailures.current = { id: session.id, count: 0 };
        pollFailures.current.count++;
        if (!cancelled && pollFailures.current.count >= 3)
          setPausedSessionId(session.id);
        if (!cancelled)
          setError(
            e instanceof Error
              ? e.message
              : "Refresh failed. The call may still be active.",
          );
      } finally {
        polling = false;
      }
    }, 5000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [caseId, session, pausedSessionId]);

  /** Sends an explicit control once; errors remain visible and failed controls never claim success. */
  async function act(
    body: unknown,
    nextScreen?: "review" | "live" | "outcome",
  ) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/cases/${caseId}/call-workspace`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await response.json();
      if (!response.ok)
        throw new Error(data.message ?? "The call action could not be saved.");
      setSessionId(data.id);
      if ((body as { action?: string }).action === "refresh" && !data.error) {
        setPausedSessionId(null);
        pollFailures.current = { id: data.id, count: 0 };
      }
      await load();
      if (nextScreen) setScreen(nextScreen);
      await onChange();
    } catch (e) {
      setError(e instanceof Error ? e.message : "The call action failed.");
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  /** Edits invalidate the local approval checkbox; saved plans remain immutable. */
  function edit(next: CallReview) {
    setReview(next);
    setApproved(false);
  }

  /** Sends the exact consent phrase to the existing bounded consent workflow; it authorizes no payment. */
  async function giveConsent() {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/cases/${caseId}/consent`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: consentText }),
      });
      const data = await response.json();
      if (!response.ok)
        throw new Error(data.message ?? "Consent was not recorded.");
      setConsentText("");
      await onChange();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Consent could not be saved.");
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  /** Display-only countdown; server-side request expiry determines whether consent is valid. */
  const remaining = consent.pendingRequest
    ? Math.max(
        0,
        Math.ceil((Date.parse(consent.pendingRequest.at) + 40000 - now) / 1000),
      )
    : 0;
  return (
    <section className="paper-findings call-workspace" aria-busy={busy}>
      <p className="paper-kicker">Patient call controls</p>
      <h3>Review, watch and follow through</h3>
      <nav aria-label="Call screens" className="call-tabs">
        {(["review", "live", "outcome"] as const).map((key) => (
          <button
            key={key}
            type="button"
            aria-current={screen === key ? "step" : undefined}
            disabled={key !== "review" && !session}
            className={screen === key ? "paper-primary" : "paper-secondary"}
            onClick={() => setScreen(key)}
          >
            {key === "review"
              ? "1. Pre-call review"
              : key === "live"
                ? "2. Live call"
                : "3. Call outcome"}
          </button>
        ))}
      </nav>
      {error && (
        <p role="alert" className="rounded-lg bg-red-50 p-3">
          {error}{" "}
          <button
            className="paper-text-button"
            onClick={() => load().catch((e: Error) => setError(e.message))}
          >
            Reload workspace
          </button>
        </p>
      )}
      {disabled && (
        <p className="rounded-lg bg-amber-50 p-3">
          Save your case preferences before approving or starting contact. End
          and take over remain available.
        </p>
      )}
      {!view && <p role="status">Loading saved call workspace…</p>}
      {screen === "review" && view && (
        <>
          {view.unavailableReason && (
            <p className="paper-copy">{view.unavailableReason}</p>
          )}
          <label className="call-field">
            Call mode
            <select
              value={mode}
              onChange={(e) => {
                const m = e.target.value as "live" | "rehearsal";
                setMode(m);
                setApproved(false);
                if (m === "live")
                  setReview({
                    ...review,
                    recipient: "",
                    phone: "",
                    patientPhone: "",
                  });
              }}
            >
              <option value="rehearsal">
                Synthetic rehearsal · no phone calls
              </option>
              <option value="live">Live provider call</option>
            </select>
          </label>
          <p className="paper-copy">
            {mode === "rehearsal"
              ? "All voices and offers below are fixed synthetic examples. No office or patient number is dialed."
              : "Starting this call contacts the recipient you approve. Check the number against your document before continuing."}
          </p>
          <div className="call-form-grid">
            {(["recipient", "phone", "patientPhone", "purpose"] as const).map(
              (key) => (
                <label className="call-field" key={key}>
                  {key === "recipient"
                    ? "Recipient / billing office"
                    : key === "phone"
                      ? "Office number (+country code)"
                      : key === "patientPhone"
                        ? "Your takeover number (+country code)"
                        : "Purpose of this call"}
                  <input
                    value={review[key]}
                    type={
                      key.includes("Phone") || key === "phone" ? "tel" : "text"
                    }
                    maxLength={key === "purpose" ? 500 : 150}
                    onChange={(e) => edit({ ...review, [key]: e.target.value })}
                  />
                </label>
              ),
            )}
          </div>
          <fieldset className="space-y-3">
            <legend className="font-semibold">
              Exactly what may be disclosed
            </legend>
            {view.disclosures.map((choice) => (
              <label className="call-disclosure" key={choice.key}>
                <input
                  type="checkbox"
                  checked={review.disclosures.includes(choice.key)}
                  onChange={(e) =>
                    edit({
                      ...review,
                      disclosures: e.target.checked
                        ? [...review.disclosures, choice.key]
                        : review.disclosures.filter(
                            (key) => key !== choice.key,
                          ),
                    })
                  }
                />
                <span className="whitespace-pre-line">{choice.text}</span>
              </label>
            ))}
            {view.disclosures.length === 0 && (
              <p>
                Confirm and check an itemized bill first to make disclosure
                choices available.
              </p>
            )}
          </fieldset>
          <p className="rounded-lg bg-[var(--paper-surface)] p-3">
            Restrictions: no payments, no agreements, no additional disclosures.
            An offer needs your review and written proof. Identity verification
            can require you on the phone.
          </p>
          <label className="call-disclosure">
            <input
              type="checkbox"
              checked={approved}
              onChange={(e) => setApproved(e.target.checked)}
            />
            <span>
              I approve this recipient, purpose, listed disclosures and takeover
              number for this{" "}
              {mode === "rehearsal" ? "synthetic rehearsal" : "call"}.
            </span>
          </label>
          <button
            className="paper-primary"
            disabled={
              busy || disabled || !approved || !review.disclosures.length
            }
            onClick={() =>
              act({ action: "prepare", review, mode, approve: true })
            }
          >
            Save approved {mode === "rehearsal" ? "rehearsal" : "call"} plan
          </button>
          {session?.status === "prepared" && (
            <article className="billless-document-card">
              <h4 className="font-semibold">Saved approved plan</h4>
              <p>
                {session.review.recipient} · {session.review.phone}
              </p>
              <p>{session.review.purpose}</p>
              {session.disclosures.map((d) => (
                <p className="whitespace-pre-line mt-2" key={d.key}>
                  {d.text}
                </p>
              ))}
              <p>
                Takeover number: {session.review.patientPhone}. No payments or
                commitments.
              </p>
              <button
                className="paper-primary mt-3"
                disabled={
                  busy ||
                  disabled ||
                  (session.mode === "live" && !view.available)
                }
                onClick={() =>
                  act({ action: "start", sessionId: session.id }, "live")
                }
              >
                {session.mode === "rehearsal"
                  ? "Start synthetic rehearsal"
                  : "Start approved call"}
              </button>
            </article>
          )}
        </>
      )}
      {screen === "live" && session && (
        <>
          <div className="billless-document-card">
            <p className="paper-kicker">
              {session.mode === "rehearsal"
                ? "Synthetic rehearsal · no real call"
                : session.review.recipient}
            </p>
            <h4 className="text-xl font-semibold" role="status">
              {STATUS[session.status]}
            </h4>
            <p className="paper-copy">{session.review.purpose}</p>
            {session.error && (
              <p role="alert" className="text-red-800">
                {session.error}
              </p>
            )}
          </div>
          {consent.pendingRequest && session.mode === "live" && (
            <div className="billless-document-card">
              <h4 className="font-semibold">Your consent is needed</h4>
              <p>
                {remaining > 0
                  ? `${remaining}s remaining. Silence means no consent.`
                  : "The consent window expired. No consent was granted by the timeout; take over or arrange a callback."}
              </p>
              <label className="call-field">
                Type: I consent to Billy representing me
                <input
                  value={consentText}
                  onChange={(e) => setConsentText(e.target.value)}
                />
              </label>
              <button
                disabled={busy || disabled || remaining === 0}
                className="paper-primary"
                onClick={giveConsent}
              >
                Record consent
              </button>
              <p className="paper-copy text-sm">
                Consent is for representation only. It does not authorize a
                payment, an agreement or further disclosure.
              </p>
            </div>
          )}
          {session.decision && (
            <div className="billless-document-card">
              <h4 className="font-semibold">Review the office’s proposal</h4>
              <p className="paper-copy text-sm">
                Reported verbatim by the voice agent. Compare it with the
                transcript. This screen cannot accept an agreement or payment.
              </p>
              <blockquote className="my-3">
                “{session.decision.statement}”
              </blockquote>
              <p role="status">
                {session.decision.resolution
                  ? `Recorded choice: ${session.decision.resolution.replaceAll("_", " ")}`
                  : Date.parse(session.decision.expiresAt) <= now
                    ? "The decision timed out. No agreement was authorized."
                    : `${Math.ceil((Date.parse(session.decision.expiresAt) - now) / 1000)}s to respond. Silence means decline.`}
              </p>
              <div className="call-tabs">
                {(["ask_written", "decline", "takeover"] as const).map(
                  (choice) => (
                    <button
                      key={choice}
                      className="paper-secondary"
                      disabled={
                        busy ||
                        Boolean(session.decision?.resolution) ||
                        Date.parse(session.decision!.expiresAt) <= now
                      }
                      onClick={() =>
                        act({
                          action: "decision",
                          sessionId: session.id,
                          decisionId: session.decision!.id,
                          resolution: choice,
                        })
                      }
                    >
                      {choice === "ask_written"
                        ? "Ask for written details"
                        : choice === "decline"
                          ? "Decline proposal"
                          : "Ask to speak directly"}
                    </button>
                  ),
                )}
              </div>
            </div>
          )}
          <div className="billless-document-card">
            <h4 className="font-semibold">Running transcript</h4>
            <p className="paper-copy text-sm">
              Original provider words, as available. Publication may lag the
              call; an empty transcript does not mean silence.
            </p>
            {session.transcript.length === 0 && (
              <p role="status">Waiting for provider transcript…</p>
            )}
            <ol className="call-transcript">
              {session.transcript.map((turn, index) => (
                <li key={index}>
                  <time>{turn.atSecs}s</time>
                  <span>
                    <strong>
                      {turn.role === "agent" ? "Assistant" : "Other party"}:
                    </strong>{" "}
                    {turn.message}
                  </span>
                </li>
              ))}
            </ol>
          </div>
          {!FINISHED_CALL_STATES.has(session.status) && (
            <div className="call-tabs">
              <button
                disabled={busy}
                className="paper-secondary"
                onClick={() =>
                  act({ action: "takeover", sessionId: session.id })
                }
              >
                Take over
                {session.mode === "live"
                  ? ` · dial ${session.review.patientPhone}`
                  : " rehearsal"}
              </button>
              <button
                disabled={busy}
                className="paper-secondary"
                onClick={() => act({ action: "end", sessionId: session.id })}
              >
                End call
              </button>
              {session.mode === "rehearsal" &&
                session.status === "in-progress" && (
                  <button
                    className="paper-primary"
                    disabled={busy}
                    onClick={() =>
                      act({ action: "rehearsal_next", sessionId: session.id })
                    }
                  >
                    {session.rehearsalStep === 0
                      ? "Show synthetic office offer"
                      : "Ask for written proof and finish"}
                  </button>
                )}
            </div>
          )}
          {session.mode === "live" && (
            <button
              className="paper-text-button"
              disabled={busy}
              onClick={() => act({ action: "refresh", sessionId: session.id })}
            >
              Refresh provider status
            </button>
          )}
          {FINISHED_CALL_STATES.has(session.status) && (
            <button
              className="paper-primary"
              onClick={() => setScreen("outcome")}
            >
              Review call outcome
            </button>
          )}
          <p className="paper-copy text-sm">
            If transfer is unavailable, end the assistant call and call the
            office yourself at {session.review.phone}. Transfer requests are
            shown until the provider reports the call ended.
          </p>
        </>
      )}
      {screen === "outcome" && session && (
        <CallOutcomePanel
          key={`${session.id}:${session.outcome ? JSON.stringify(session.outcome) : "new"}`}
          session={session}
          busy={busy}
          onSave={(outcome) => act({ action: "outcome", outcome })}
        />
      )}
      {view && view.sessions.length > 0 && (
        <label className="call-field mt-4">
          Saved call plans and outcomes
          <select
            value={sessionId ?? ""}
            onChange={(e) => {
              setSessionId(e.target.value);
              const s = view.sessions.find(
                (item) => item.id === e.target.value,
              );
              setScreen(
                s && FINISHED_CALL_STATES.has(s.status) ? "outcome" : "live",
              );
            }}
          >
            <option value="" disabled>
              Select a call
            </option>
            {[...view.sessions].reverse().map((s) => (
              <option key={s.id} value={s.id}>
                {new Date(s.createdAt).toLocaleString()} · {s.mode} ·{" "}
                {STATUS[s.status]}
              </option>
            ))}
          </select>
        </label>
      )}
    </section>
  );
}

/**
 * Presents verbatim offer/evidence selection and patient-authored follow-up, separate from verified savings.
 * @param props - Finished session, mutation state and explicit save callback.
 * @returns Persistent outcome review; it proposes actions without sending requests or accepting terms.
 */
function CallOutcomePanel({
  session,
  busy,
  onSave,
}: {
  session: CallSession;
  busy: boolean;
  onSave: (outcome: CallOutcome) => void;
}) {
  /** Original transcript turn indexes explicitly selected by the patient. */
  const [selected, setSelected] = useState(session.outcome?.turnIndexes ?? []);
  /** Proposed follow-up category, never a commitment or permission to send. */
  const [nextStep, setNextStep] = useState<CallOutcome["nextStep"]>(
    session.outcome?.nextStep ?? "request_written_proof",
  );
  /** Optional patient-proposed date; saving creates no automatic contact. */
  const [dueDate, setDueDate] = useState(session.outcome?.dueDate ?? "");
  /** Patient-authored text kept verbatim and separate from clinical evidence. */
  const [note, setNote] = useState(session.outcome?.note ?? "");
  if (!FINISHED_CALL_STATES.has(session.status))
    return (
      <p>
        The call is still active. Review the outcome after it ends, or use Take
        over.
      </p>
    );
  return (
    <div className="space-y-4">
      <h4 className="text-xl font-semibold">Call outcome review</h4>
      <p>
        {STATUS[session.status]} ·{" "}
        {session.mode === "rehearsal" ? "Synthetic rehearsal" : "Provider call"}
      </p>
      <p className="rounded-lg bg-amber-50 p-3">
        A verbal offer is not confirmed savings. Nothing here accepts an offer,
        schedules contact or changes the verified bill balance. Get written
        proof, then check the revised statement on this case.
      </p>
      <fieldset>
        <legend className="font-semibold">
          Select original turns that record offers or next steps
        </legend>
        {session.transcript.length === 0 && (
          <p>
            No transcript is available. Record the uncertainty in your note and
            arrange human review.
          </p>
        )}
        {session.transcript.map((turn, index) => (
          <label className="call-disclosure" key={index}>
            <input
              type="checkbox"
              checked={selected.includes(index)}
              onChange={(e) =>
                setSelected(
                  e.target.checked
                    ? [...selected, index]
                    : selected.filter((i) => i !== index),
                )
              }
            />
            <span>
              {turn.atSecs}s ·{" "}
              {turn.role === "agent" ? "Assistant" : "Other party"}: “
              {turn.message}”
            </span>
          </label>
        ))}
      </fieldset>
      <label className="call-field">
        Your proposed next step
        <select
          value={nextStep}
          onChange={(e) =>
            setNextStep(e.target.value as CallOutcome["nextStep"])
          }
        >
          <option value="request_written_proof">Request written proof</option>
          <option value="follow_up">Follow up with the office</option>
          <option value="human_review">Take over / ask for human review</option>
          <option value="no_follow_up">No follow-up planned</option>
        </select>
      </label>
      <label className="call-field">
        Proposed follow-up date (optional)
        <input
          type="date"
          value={dueDate}
          onChange={(e) => setDueDate(e.target.value)}
        />
      </label>
      <label className="call-field">
        Your note (kept as you wrote it)
        <textarea
          rows={3}
          maxLength={1000}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </label>
      <button
        className="paper-primary"
        disabled={busy}
        onClick={() =>
          onSave({
            sessionId: session.id,
            turnIndexes: selected,
            nextStep,
            dueDate: dueDate || null,
            note,
          })
        }
      >
        Save outcome review
      </button>
      {session.outcome && (
        <p role="status">
          Last saved outcome is on this case. Save again to keep edits. Any
          contact still needs a separate approval.
        </p>
      )}
      <p className="paper-copy text-sm">
        Use the case’s paperwork and approved actions to request or upload
        written evidence.
      </p>
    </div>
  );
}
