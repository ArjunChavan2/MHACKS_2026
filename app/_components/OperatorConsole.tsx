"use client";
/**
 * @file Operator console: a teammate plays the billing office during the demo (SPEC.md §3.5, §6
 * MVP 2). **Simulated** and labeled as such everywhere. It records structured responses through
 * `POST /api/cases/[id]/responses` and can send the sample revised statement; the agent only sees
 * what is recorded, never which branch was picked.
 */
import { useEffect, useState } from "react";
import type { CaseView } from "@/lib/cases/service";
import type { CounterpartyResponse, Finding } from "@/lib/types";

/** Who the office signs as. */
const OFFICE = "Quillhaven Medical Group billing office";
/** Who sends lab records. */
const LAB = "Quillhaven laboratory";

/**
 * Today plus some days, as YYYY-MM-DD (local date).
 *
 * @param days - Days to add.
 * @returns ISO date.
 */
function inDays(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Finds a finding ID by rule.
 *
 * @param findings - Case findings.
 * @param rule - Rule ID.
 * @returns The ID, or undefined.
 */
function idOf(findings: Finding[], rule: Finding["rule"]): string | undefined {
  return findings.find((f) => f.rule === rule)?.id;
}

/** One preset the operator can send with a single click. */
interface Preset {
  key: string;
  label: string;
  /** What the case should do, for the operator's eyes only. */
  expect: string;
  build: (f: Finding[]) => (CounterpartyResponse & { attachSample?: string }) | null;
}

/** The demo branches (SPEC.md §3.5) plus the follow-ups that complete them. */
const PRESETS: Preset[] = [
  {
    key: "confirms",
    label: "A. Confirm the duplicate TSH (error)",
    expect: "Duplicate and over-EOB become 'office confirmed'; $68 offered; case waits for a revised statement.",
    build: (f) => {
      const dup = idOf(f, "duplicate_charge");
      const eob = idOf(f, "bill_exceeds_eob");
      if (!dup) return null;
      return {
        from: OFFICE,
        perFinding: [{ findingId: dup, kind: "confirms_error" }, ...(eob ? [{ findingId: eob, kind: "confirms_error" as const }] : [])],
        attachSample: "response-confirms",
      };
    },
  },
  {
    key: "disproves",
    label: "B. Send the free T4 lab report (disproves)",
    expect: "Free T4 concern withdrawn with the lab report cited; questioned drops by $54; case continues with the rest.",
    build: (f) => {
      const gap = idOf(f, "documentation_gap");
      return gap ? { from: OFFICE, perFinding: [{ findingId: gap, kind: "provides_documentation" }], attachSample: "lab-result-ft4" } : null;
    },
  },
  {
    key: "incomplete",
    label: "C. 'The lab will send it later' (incomplete)",
    expect: "Free T4 stays pending; task assigned to the lab with a follow-up date; case waits.",
    build: (f) => {
      const gap = idOf(f, "documentation_gap");
      return gap
        ? {
            from: OFFICE,
            perFinding: [{ findingId: gap, kind: "will_send_later", neededDocument: "free T4 lab record", responsibleParty: LAB, promisedBy: inDays(7) }],
            attachSample: "response-incomplete",
          }
        : null;
    },
  },
  {
    key: "lab-arrives",
    label: "C, later. Lab record arrives",
    expect: "The waiting task closes; the free T4 concern is withdrawn with the record cited; the case resumes.",
    build: (f) => {
      const gap = idOf(f, "documentation_gap");
      return gap ? { from: LAB, perFinding: [{ findingId: gap, kind: "provides_documentation" }], attachSample: "lab-result-ft4" } : null;
    },
  },
];

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
 * The operator console.
 *
 * @returns The console.
 */
export default function OperatorConsole() {
  const [caseId, setCaseId] = useState("");
  const [view, setView] = useState<CaseView | null>(null);
  const [note, setNote] = useState("");
  const [log, setLog] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  /**
   * Loads a case by ID.
   *
   * @param id - Case ID.
   */
  async function load(id: string) {
    if (!id) return;
    const res = await fetch(`/api/cases/${id}`, { cache: "no-store" });
    if (!res.ok) {
      setView(null);
      setLog((l) => [`Case ${id} not found.`, ...l]);
      return;
    }
    setView((await res.json()) as CaseView);
    const url = new URL(window.location.href);
    url.searchParams.set("case", id);
    window.history.replaceState(null, "", url);
  }

  // Prefill from ?case= on first load.
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("case");
    if (!id) return;
    let cancelled = false;
    fetch(`/api/cases/${id}`, { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<CaseView>) : null))
      .then((v) => {
        if (cancelled) return;
        setCaseId(id);
        setView(v);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  /**
   * Runs one operator step and logs the outcome.
   *
   * @param label - What was done.
   * @param fn - The request.
   */
  async function step(label: string, fn: () => Promise<unknown>) {
    setBusy(true);
    try {
      await fn();
      setLog((l) => [`✓ ${label}`, ...l]);
      setNote("");
      await load(caseId);
    } catch (e) {
      setLog((l) => [`✗ ${label}: ${e instanceof Error ? e.message : String(e)}`, ...l]);
    } finally {
      setBusy(false);
    }
  }

  const findings = view?.audit?.findings ?? [];

  return (
    <main className="paper-app">
      <header className="paper-header">
        <span className="paper-wordmark">
          Bill<span>Less</span>
          <span className="billless-brand-dot">.</span> operator
        </span>
        <span className="paper-badge paper-review-badge">Simulated billing office</span>
      </header>
      <p className="mb-4 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900 ring-1 ring-amber-200">
        Demo tool. A teammate plays Quillhaven&apos;s billing office here. Responses are recorded as structured answers; the
        patient&apos;s app only sees what is recorded, never which branch you picked. Nothing here is real correspondence.
      </p>

      <section className="paper-flow space-y-4">
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void load(caseId.trim());
          }}
        >
          <input
            value={caseId}
            onChange={(e) => setCaseId(e.target.value)}
            placeholder="Case ID (shown at the bottom of the patient's case screen)"
            className="flex-1 rounded-md px-3 py-2 ring-1 ring-[var(--paper-border)]"
            aria-label="Case ID"
          />
          <button className="paper-secondary" type="submit">
            Load
          </button>
        </form>

        {view && (
          <>
            <div className="paper-findings">
              <h3>Case {view.caseId}: {view.state.phase.replaceAll("_", " ")}</h3>
              <ul className="space-y-1 text-sm">
                {findings.map((f) => (
                  <li key={f.id}>
                    <strong>{f.title}</strong> · {f.status}
                    {f.verified ? " (verified)" : ""}
                  </li>
                ))}
              </ul>
              {!view.state.timeline.some((e) => e.type === "dispute_sent") && (
                <p className="mt-2 text-sm text-amber-800">The patient hasn&apos;t approved sending the dispute yet. Wait for that before answering.</p>
              )}
            </div>

            <label className="block text-sm">
              Note from the office (optional, shown to the patient word for word)
              <textarea value={note} onChange={(e) => setNote(e.target.value)} className="mt-1 w-full rounded-md p-2 ring-1 ring-[var(--paper-border)]" rows={2} />
            </label>

            <div className="space-y-2">
              {PRESETS.map((p) => {
                const body = p.build(findings);
                return (
                  <div key={p.key} className="paper-finding">
                    <button
                      className="paper-primary"
                      disabled={busy || !body}
                      onClick={() => body && step(p.label, () => post(`/api/cases/${view.caseId}/responses`, { ...body, ...(note ? { note } : {}) }))}
                    >
                      {p.label}
                    </button>
                    <p className="paper-copy text-xs">Expected: {p.expect}</p>
                  </div>
                );
              })}
              <div className="paper-finding">
                <button
                  className="paper-primary"
                  disabled={busy}
                  onClick={() => step("Revised statement sent", () => post("/api/documents/sample", { name: "revised-statement", caseId: view.caseId }))}
                >
                  A, later. Send the revised statement
                </button>
                <p className="paper-copy text-xs">Expected: the patient confirms it; $68 becomes confirmed savings and the duplicate is verified.</p>
              </div>
            </div>
          </>
        )}

        {log.length > 0 && (
          <ol className="space-y-1 font-mono text-xs">
            {log.map((l, i) => (
              <li key={i}>{l}</li>
            ))}
          </ol>
        )}
      </section>
    </main>
  );
}
