"use client";
/**
 * @file The MVP 1 flow in the browser: start → confirm → audit → letter (SPEC.md §6 MVP 1).
 *
 * Talks only to our API routes. Never computes findings or writes facts itself: findings come from
 * `/api/audit` and letters from `/api/letters`. Labels anything that came from a saved sample
 * document so a demo never passes a fixture off as live (SPEC.md §2 rule 9).
 */
import { useMemo, useState } from "react";
import type { ExtractionResult } from "@/lib/extract/pipeline";
import type { IngestResponse } from "@/lib/cases/service";
import { fieldLabel, usd } from "@/lib/format";
import type { AuditResult, Draft, ExtractedBill, Field, Finding, Source } from "@/lib/types";

/** Which screen is showing. */
type Step = "start" | "confirm" | "audit" | "letter" | "request";

/** One uploaded document as tracked in the browser. */
interface DocState {
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

/** Audit response from the API. */
type AuditResponse = AuditResult & { providers: string[] };

/**
 * Lists every field in an extraction with its path, in document order.
 *
 * @param r - Extraction result (bill or EOB).
 * @returns Path/field pairs; empty for unsupported documents.
 */
function listFields(r: ExtractionResult): Array<[string, Field<unknown>]> {
  const out: Array<[string, Field<unknown>]> = [];
  if (r.kind === "bill") {
    for (const [k, f] of Object.entries(r.bill.header)) out.push([`header.${k}`, f]);
    r.bill.lines.forEach((l, i) => Object.entries(l).forEach(([k, f]) => out.push([`lines.${i}.${k}`, f as Field<unknown>])));
  } else if (r.kind === "eob") {
    const { insurer, claimNumber, provider, totalPatientResponsibility } = r.eob;
    out.push(["insurer", insurer], ["claimNumber", claimNumber], ["provider", provider], ["totalPatientResponsibility", totalPatientResponsibility]);
    r.eob.lines.forEach((l, i) => Object.entries(l).forEach(([k, f]) => out.push([`lines.${i}.${k}`, f as Field<unknown>])));
  }
  return out;
}

/**
 * Sends JSON to an API route and returns the parsed reply or throws with the server's message.
 *
 * @param url - API path.
 * @param body - JSON body.
 * @returns Parsed JSON.
 * @throws {Error} With the server's message on non-2xx responses.
 */
async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message ?? "Request failed");
  return data as T;
}

/**
 * Root component for the MVP 1 flow.
 *
 * @returns The current screen.
 */
export default function BillAuditApp() {
  const [step, setStep] = useState<Step>("start");
  const [bill, setBill] = useState<DocState | null>(null);
  const [eob, setEob] = useState<DocState | null>(null);
  const [audit, setAudit] = useState<AuditResponse | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const caseId = bill?.ingest.caseId ?? eob?.ingest.caseId ?? null;
  const usedSample = [bill, eob].some((d) => d?.ingest.result.meta.source === "saved-fixture");

  /**
   * Wraps an async action with busy and error state.
   *
   * @param fn - Action to run.
   */
  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  /**
   * Routes a newly ingested document into bill or EOB state.
   *
   * @param ingest - Server response.
   */
  function accept(ingest: IngestResponse) {
    const state: DocState = { ingest, corrections: {}, confirmedPaths: [], ackTotals: false, confirmed: false, blocking: [] };
    const r = ingest.result;
    if (r.kind === "unsupported") throw new Error(r.reason);
    if (r.kind === "eob") setEob(state);
    else setBill(state);
  }

  /** Uploads a file through Gemini extraction. */
  async function upload(file: File) {
    await run(async () => {
      const form = new FormData();
      form.append("file", file);
      if (caseId) form.append("caseId", caseId);
      const res = await fetch("/api/documents", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message ?? "Upload failed");
      accept(data as IngestResponse);
    });
  }

  /** Loads a saved synthetic sample through the labeled no-AI path. */
  async function loadSample(name: string) {
    await run(async () => accept(await postJson<IngestResponse>("/api/documents/sample", { name, caseId })));
  }

  /** Loads the demo pair (sample bill and sample EOB). */
  async function loadDemoPair() {
    await run(async () => {
      const b = await postJson<IngestResponse>("/api/documents/sample", { name: "sample-bill", caseId: null });
      accept(b);
      accept(await postJson<IngestResponse>("/api/documents/sample", { name: "sample-eob", caseId: b.caseId }));
    });
  }

  /** Moves on from the start screen once a bill is present. */
  function next() {
    if (bill?.ingest.result.kind === "bill" && bill.ingest.result.bill.docType === "balance_statement") setStep("request");
    else setStep("confirm");
  }

  /**
   * Submits one document's confirmation.
   *
   * @param doc - Document state.
   * @param set - State setter for that document.
   * @returns Whether it locked.
   */
  async function confirmOne(doc: DocState, set: (d: DocState) => void): Promise<boolean> {
    if (doc.confirmed) return true;
    const r = await postJson<{ ok: boolean; blocking?: string[] }>(`/api/documents/${doc.ingest.documentId}/confirm`, {
      corrections: doc.corrections,
      confirmedPaths: doc.confirmedPaths,
      acknowledgeTotalsMismatch: doc.ackTotals,
    });
    set({ ...doc, confirmed: r.ok, blocking: r.blocking ?? [] });
    return r.ok;
  }

  /** Confirms both documents, then runs the audit. */
  async function confirmAndAudit() {
    await run(async () => {
      if (!bill) return;
      const okBill = await confirmOne(bill, setBill);
      const okEob = eob ? await confirmOne(eob, setEob) : true;
      if (!okBill || !okEob) return;
      setAudit(await postJson<AuditResponse>("/api/audit", { caseId, billId: bill.ingest.documentId, eobId: eob?.ingest.documentId ?? null }));
      setStep("audit");
    });
  }

  /** Requests the dispute letter. */
  async function makeLetter() {
    await run(async () => {
      if (!bill) return;
      const { draft } = await postJson<{ draft: Draft }>("/api/letters", { caseId, billId: bill.ingest.documentId, eobId: eob?.ingest.documentId ?? null });
      setDraft(draft);
      setStep("letter");
    });
  }

  /** Requests the itemized-bill request draft for a balance statement. */
  async function makeRequest() {
    await run(async () => {
      if (!bill) return;
      const { draft } = await postJson<{ draft: Draft }>("/api/requests/itemized", { documentId: bill.ingest.documentId });
      setDraft(draft);
      setStep("letter");
    });
  }

  /** Starts over. */
  function reset() {
    setStep("start");
    setBill(null);
    setEob(null);
    setAudit(null);
    setDraft(null);
    setError(null);
  }

  return (
    <main className="mx-auto max-w-3xl px-4 py-6">
      <header className="mb-5 flex items-center justify-between">
        <h1 className="text-xl font-bold tracking-tight">Bill Advocate</h1>
        {step !== "start" && (
          <button onClick={reset} className="text-sm text-slate-500 underline">
            Start over
          </button>
        )}
      </header>
      {usedSample && (
        <p className="mb-4 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900 ring-1 ring-amber-200">
          Sample document (synthetic data), read without AI from a saved answer. Same checks as a live upload.
        </p>
      )}
      {error && <p className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-800 ring-1 ring-red-200">{error}</p>}

      {step === "start" && (
        <StartScreen bill={bill} eob={eob} busy={busy} onUpload={upload} onSample={loadSample} onDemo={loadDemoPair} onNext={next} />
      )}
      {step === "confirm" && bill && (
        <section className="space-y-6">
          <ConfirmPanel title="Your bill" doc={bill} onChange={setBill} />
          {eob && <ConfirmPanel title="Your explanation of benefits (EOB)" doc={eob} onChange={setEob} />}
          <button disabled={busy} onClick={confirmAndAudit} className="w-full rounded-lg bg-slate-900 py-3 font-semibold text-white disabled:opacity-50">
            {busy ? "Checking…" : "Confirm and check my bill"}
          </button>
        </section>
      )}
      {step === "audit" && audit && bill?.ingest.result.kind === "bill" && (
        <AuditScreen audit={audit} bill={bill.ingest.result.bill} busy={busy} onLetter={makeLetter} />
      )}
      {step === "request" && bill && (
        <section className="space-y-4 rounded-xl bg-white p-5 ring-1 ring-slate-200">
          <h2 className="text-lg font-semibold">This is a balance statement, not an itemized bill</h2>
          <p className="text-sm text-slate-600">
            It shows a total but no individual charges, so there is nothing to check yet. We never rebuild charges from a total. The next
            step is to ask the provider for a fully itemized bill, and to get your explanation of benefits (EOB) from your insurer&apos;s
            website or app.
          </p>
          <button disabled={busy} onClick={makeRequest} className="w-full rounded-lg bg-slate-900 py-3 font-semibold text-white disabled:opacity-50">
            Draft my itemized-bill request
          </button>
        </section>
      )}
      {step === "letter" && draft && <LetterScreen draft={draft} />}
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
    <section className="space-y-5">
      <div className="rounded-xl bg-white p-5 ring-1 ring-slate-200">
        <h2 className="text-lg font-semibold">What do you have?</h2>
        <p className="mt-1 text-sm text-slate-600">
          Upload your itemized bill and, if you have it, the explanation of benefits (EOB) from your insurer. A PDF works best; a clear photo
          works too.
        </p>
        <label className="mt-4 block cursor-pointer rounded-lg border-2 border-dashed border-slate-300 p-6 text-center text-sm text-slate-600 hover:bg-slate-50">
          {busy ? "Reading your document…" : "Tap to upload a bill, EOB, or statement"}
          <input
            type="file"
            accept="application/pdf,image/*"
            className="hidden"
            disabled={busy}
            onChange={(e) => e.target.files?.[0] && props.onUpload(e.target.files[0])}
          />
        </label>
        <ul className="mt-4 space-y-1 text-sm">
          <li>Bill: {bill ? <b>{bill.ingest.result.kind === "bill" ? bill.ingest.result.bill.docType.replace("_", " ") : "?"}</b> : <span className="text-slate-400">not added</span>}</li>
          <li>EOB: {eob ? <b>added</b> : <span className="text-slate-400">optional</span>}</li>
        </ul>
        <button disabled={!bill || busy} onClick={props.onNext} className="mt-4 w-full rounded-lg bg-slate-900 py-3 font-semibold text-white disabled:opacity-40">
          Continue
        </button>
      </div>
      <div className="rounded-xl bg-white p-5 ring-1 ring-slate-200">
        <h3 className="font-semibold">Try with sample documents (synthetic)</h3>
        <div className="mt-3 flex flex-wrap gap-2 text-sm">
          <button disabled={busy} onClick={props.onDemo} className="rounded-md bg-slate-900 px-3 py-2 text-white">Sample bill + EOB</button>
          <button disabled={busy} onClick={() => props.onSample("balance-statement")} className="rounded-md bg-slate-100 px-3 py-2">Only a balance statement</button>
          <button disabled={busy} onClick={() => props.onSample("bill-broken-totals")} className="rounded-md bg-slate-100 px-3 py-2">Bill with broken totals</button>
        </div>
      </div>
    </section>
  );
}

/**
 * Confirm panel for one document: preview, flagged fields first, verified fields in one tap.
 *
 * @param props.title - Panel heading.
 * @param props.doc - Document state.
 * @param props.onChange - Updates the document state.
 * @returns The confirm panel.
 */
function ConfirmPanel({ title, doc, onChange }: { title: string; doc: DocState; onChange: (d: DocState) => void }) {
  const fields = useMemo(() => listFields(doc.ingest.result), [doc.ingest.result]);
  const flagged = fields.filter(([, f]) => f.verification === "needs_attention");
  const verified = fields.filter(([, f]) => f.verification === "verified" && f.status !== "absent");
  const r = doc.ingest.result;
  const docIssues = r.kind === "bill" ? r.bill.documentIssues : r.kind === "eob" ? r.eob.documentIssues : [];
  const [showVerified, setShowVerified] = useState(false);
  const [previewPage, setPreviewPage] = useState(1);

  /**
   * Records a correction for a field.
   *
   * @param path - Field path.
   * @param value - New raw value.
   */
  function correct(path: string, value: string) {
    onChange({ ...doc, corrections: { ...doc.corrections, [path]: value } });
  }

  /**
   * Toggles "confirmed as printed" for a flagged field.
   *
   * @param path - Field path.
   */
  function toggleConfirm(path: string) {
    const has = doc.confirmedPaths.includes(path);
    onChange({ ...doc, confirmedPaths: has ? doc.confirmedPaths.filter((p) => p !== path) : [...doc.confirmedPaths, path] });
  }

  return (
    <div className="rounded-xl bg-white p-5 ring-1 ring-slate-200">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">{title}</h2>
        {doc.confirmed && <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800">Confirmed and locked</span>}
      </div>
      <p className="mt-1 text-xs text-slate-500">
        {r.meta.textLayerChecked ? "Values were cross-checked against the PDF's own text." : "Photo or scan: please check every value carefully."}
      </p>
      <iframe title={`${title} preview`} src={`/api/documents/${doc.ingest.documentId}/file#page=${previewPage}`} className="mt-3 h-72 w-full rounded-md ring-1 ring-slate-200" />

      {docIssues.length > 0 && (
        <div className="mt-4 rounded-md bg-red-50 p-3 text-sm text-red-900 ring-1 ring-red-200">
          {docIssues.map((m) => (
            <p key={m}>{m}</p>
          ))}
          <label className="mt-2 flex items-start gap-2">
            <input type="checkbox" checked={doc.ackTotals} onChange={(e) => onChange({ ...doc, ackTotals: e.target.checked })} />
            <span>I checked the document: the printed totals themselves don&apos;t add up (this is how the bill is printed).</span>
          </label>
        </div>
      )}

      <h3 className="mt-5 text-sm font-semibold">Needs your attention ({flagged.length})</h3>
      {flagged.length === 0 && <p className="text-sm text-slate-500">Nothing flagged.</p>}
      <ul className="mt-2 space-y-3">
        {flagged.map(([path, f]) => (
          <li key={path} className="rounded-md bg-amber-50 p-3 ring-1 ring-amber-200">
            <div className="flex items-center justify-between text-sm font-medium">
              <span>{fieldLabel(path)}</span>
              {f.page && (
                <button className="text-xs text-slate-600 underline" onClick={() => setPreviewPage(f.page ?? 1)}>
                  page {f.page}
                </button>
              )}
            </div>
            {f.issues.map((m) => (
              <p key={m} className="text-xs text-amber-900">{m}</p>
            ))}
            {f.snippet && <p className="mt-1 rounded bg-white px-2 py-1 font-mono text-xs text-slate-600">“{f.snippet}”</p>}
            <div className="mt-2 flex items-center gap-2">
              <input
                className="flex-1 rounded border border-slate-300 px-2 py-1 text-sm"
                defaultValue={f.raw ?? ""}
                placeholder="[to confirm]"
                onChange={(e) => correct(path, e.target.value)}
              />
              <label className="flex items-center gap-1 text-xs">
                <input type="checkbox" checked={doc.confirmedPaths.includes(path)} onChange={() => toggleConfirm(path)} /> matches the document
              </label>
            </div>
          </li>
        ))}
      </ul>

      <button className="mt-4 text-sm text-slate-600 underline" onClick={() => setShowVerified((s) => !s)}>
        {showVerified ? "Hide" : "Review"} {verified.length} verified values
      </button>
      {showVerified && (
        <ul className="mt-2 divide-y divide-slate-100 text-sm">
          {verified.map(([path, f]) => (
            <li key={path} className="flex justify-between py-1">
              <span className="text-slate-500">{fieldLabel(path)}</span>
              <span className="font-mono">{f.raw}</span>
            </li>
          ))}
        </ul>
      )}
      {doc.blocking.length > 0 && (
        <div className="mt-4 rounded-md bg-red-50 p-3 text-sm text-red-900 ring-1 ring-red-200">
          <p className="font-medium">Still needs fixing before we can check the bill:</p>
          {doc.blocking.map((m) => (
            <p key={m}>• {m}</p>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Describes a source for the evidence view.
 *
 * @param s - Source.
 * @returns Plain-language description.
 */
function describeSource(s: Source): string {
  switch (s.kind) {
    case "bill_line":
      return `Bill line ${s.lineNumber}${s.provenance.page ? `, page ${s.provenance.page}` : ""}: “${s.provenance.snippet ?? ""}”`;
    case "eob_line":
      return `EOB line ${s.index + 1}: “${s.provenance.snippet ?? ""}”`;
    case "eob_total":
      return `EOB: “${s.provenance.snippet ?? ""}”`;
    case "bill_total":
      return `Bill: “${s.provenance.snippet ?? ""}”`;
    case "record":
      return `${s.fact.provider}, ${s.fact.recordedAt}: “${s.fact.text}” (record ${s.fact.recordId})`;
    case "records_searched":
      return `Searched ${s.recordsChecked} records from ${s.providers.join(" and ")}: ${s.searched}. No match.`;
  }
}

/**
 * Audit screen: verdict block, findings with evidence, and the line-by-line table.
 *
 * @param props.audit - Audit response.
 * @param props.bill - The extracted bill (for the line table).
 * @param props.busy - Whether a request is running.
 * @param props.onLetter - Requests the dispute letter.
 * @returns The audit screen.
 */
function AuditScreen({ audit, bill, busy, onLetter }: { audit: AuditResponse; bill: ExtractedBill; busy: boolean; onLetter: () => void }) {
  const [open, setOpen] = useState<string | null>(null);
  const { verdict, findings } = audit;
  const flaggedLines = new Map<number, Finding[]>();
  for (const f of findings) {
    for (const s of f.sources) if (s.kind === "bill_line") flaggedLines.set(s.lineNumber, [...(flaggedLines.get(s.lineNumber) ?? []), f]);
  }
  const cell = (label: string, v: number | null) => (
    <div className="rounded-lg bg-slate-50 p-3">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="text-lg font-semibold">{v === null ? "—" : usd(v)}</p>
    </div>
  );
  return (
    <section className="space-y-5">
      <div className="grid grid-cols-2 gap-2 rounded-xl bg-white p-4 ring-1 ring-slate-200 sm:grid-cols-4">
        {cell("Billed", verdict.totalBilledCents)}
        {cell("Questioned", verdict.questionedCents)}
        {cell("Offered", verdict.offeredCents)}
        {cell("Confirmed", verdict.confirmedCents)}
      </div>
      <div className="space-y-3">
        <h2 className="text-lg font-semibold">{findings.length ? `${findings.length} potential issue${findings.length > 1 ? "s" : ""}` : "No potential issues found"}</h2>
        <p className="text-xs text-slate-500">Checked against your records from {audit.providers.join(" and ")}. Potential issues are things to ask about, not proven errors.</p>
        {findings.map((f) => (
          <div key={f.id} className="rounded-xl bg-white p-4 ring-1 ring-slate-200">
            <p className="font-medium">⚠ {f.title}</p>
            <p className="mt-1 text-sm text-slate-700">{f.explanation}</p>
            <p className="mt-1 text-sm text-slate-700"><b>What to ask:</b> {f.ask}</p>
            <button className="mt-2 text-sm text-slate-600 underline" onClick={() => setOpen(open === f.id ? null : f.id)}>
              {open === f.id ? "Hide evidence" : "Show evidence"}
            </button>
            {open === f.id && (
              <ul className="mt-2 space-y-1 rounded-md bg-slate-50 p-3 font-mono text-xs text-slate-700">
                {f.sources.map((s, i) => (
                  <li key={i}>{describeSource(s)}</li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>
      <div className="overflow-x-auto rounded-xl bg-white ring-1 ring-slate-200">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs text-slate-500">
            <tr><th className="p-2">Line</th><th className="p-2">Code</th><th className="p-2">What it is</th><th className="p-2 text-right">Charge</th><th className="p-2">Flag</th></tr>
          </thead>
          <tbody>
            {bill.lines.map((l, i) => {
              const n = l.lineNumber.value ?? i + 1;
              return (
                <tr key={i} className={flaggedLines.has(n) ? "bg-amber-50" : ""}>
                  <td className="p-2">{n}</td>
                  <td className="p-2 font-mono">{l.code.value ?? "[to confirm]"}</td>
                  <td className="p-2">{l.description.value}</td>
                  <td className="p-2 text-right">{l.charge.value === null ? "—" : usd(l.charge.value)}</td>
                  <td className="p-2">{flaggedLines.has(n) ? "⚠" : ""}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {findings.length > 0 && (
        <button disabled={busy} onClick={onLetter} className="w-full rounded-lg bg-slate-900 py-3 font-semibold text-white disabled:opacity-50">
          {busy ? "Drafting…" : "Draft my dispute letter"}
        </button>
      )}
    </section>
  );
}

/**
 * Letter screen: click any paragraph to see its sources; download the PDF.
 *
 * @param props.draft - The finished draft.
 * @returns The letter screen.
 */
function LetterScreen({ draft }: { draft: Draft }) {
  const [selected, setSelected] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  /** Downloads the PDF for the draft. */
  async function download() {
    setBusy(true);
    try {
      const res = await fetch("/api/letters/pdf", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ draft }) });
      const blob = await res.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = draft.kind === "dispute_letter" ? "dispute-letter.pdf" : "itemized-bill-request.pdf";
      a.click();
      URL.revokeObjectURL(a.href);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-4">
      <div className="rounded-xl bg-white p-5 ring-1 ring-slate-200">
        <p className="text-xs text-slate-500">
          {draft.author === "llm" ? "Wording drafted by AI; every fact was filled in by code from your confirmed bill and findings." : "Written from our standard template; every fact was filled in by code."}{" "}
          Tap a paragraph to see where its facts came from.
        </p>
        <h2 className="mt-3 font-semibold">Re: {draft.subject}</h2>
        <div className="mt-3 space-y-3 text-sm leading-relaxed">
          {draft.paragraphs.map((p, i) => (
            <p
              key={i}
              onClick={() => setSelected(selected === i ? null : i)}
              className={`cursor-pointer whitespace-pre-line rounded p-1 ${selected === i ? "bg-sky-50 ring-1 ring-sky-200" : "hover:bg-slate-50"} ${i === draft.paragraphs.length - 1 ? "text-xs text-slate-500" : ""}`}
            >
              {p.text}
            </p>
          ))}
        </div>
        {selected !== null && (
          <div className="mt-3 rounded-md bg-sky-50 p-3 text-xs ring-1 ring-sky-200">
            {draft.paragraphs[selected].sources.length ? (
              <ul className="space-y-1 font-mono">{draft.paragraphs[selected].sources.map((s, i) => <li key={i}>{describeSource(s)}</li>)}</ul>
            ) : (
              <p>No facts from your documents in this paragraph.</p>
            )}
          </div>
        )}
      </div>
      <button disabled={busy} onClick={download} className="w-full rounded-lg bg-slate-900 py-3 font-semibold text-white disabled:opacity-50">
        Download PDF
      </button>
      <p className="text-center text-xs text-slate-500">Nothing is sent for you in this version. Review the letter, then send it yourself.</p>
    </section>
  );
}
