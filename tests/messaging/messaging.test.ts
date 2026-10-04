/**
 * @file Proves the pure iMessage core (SPEC.md §4.8, §6 MVP 3): reply parsing, link codes, text
 * fitting, grounded "why" answers built only from the finding's own strings and sources, notify
 * decisions, and prompt resolution. Case views come from the Priya demo case on the memory store.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { describeSource } from "@/app/_components/sources";
import { runCaseAction, recordResponse } from "@/lib/cases/caseflow";
import { auditCase, confirmDocument, draftLetter, ingestSample, loadCase, type CaseView } from "@/lib/cases/service";
import { memoryStore, type CaseStore } from "@/lib/cases/store";
import {
  MAX_TEXT_CHARS,
  composeStatus,
  composeUpdate,
  composeWhy,
  decideNotify,
  fit,
  matchFinding,
  newLinkCode,
  notifySnapshotOf,
  parseReply,
  resolvePrompt,
  type ImessagePrompt,
} from "@/lib/messaging";

const g = globalThis as typeof globalThis & { __mhStore?: CaseStore };
const AS_PRINTED = { corrections: {}, confirmedPaths: [], acknowledgeTotalsMismatch: false };
const LINK = "https://billless.tech/?case=case_x";
const saved = { gemini: process.env.GEMINI_API_KEY, xai: process.env.XAI_API_KEY, today: process.env.DEMO_TODAY };

/** The demo case after a manual send and a document request (card: approve the request). */
let drafted: CaseView;
/** The same case after the document request was approved (card: waiting for documentation). */
let sent: CaseView;

beforeAll(async () => {
  delete process.env.GEMINI_API_KEY;
  delete process.env.XAI_API_KEY;
  process.env.DEMO_TODAY = "2026-03-24";
  g.__mhStore = memoryStore();
  const bill = await ingestSample(null, "sample-bill");
  const eob = await ingestSample(bill.caseId, "sample-eob");
  await confirmDocument(bill.documentId, AS_PRINTED);
  await confirmDocument(eob.documentId, AS_PRINTED);
  await auditCase(bill.caseId, bill.documentId, eob.documentId);
  await draftLetter(bill.caseId, bill.documentId, eob.documentId);
  const manual = (await loadCase(bill.caseId)) as CaseView;
  await runCaseAction(bill.caseId, { actionId: "record_letter_sent", target: manual.state.next.target, sentAt: "2026-03-23" });
  const gap = manual.audit!.findings.find((f) => f.rule === "documentation_gap")!;
  await recordResponse(bill.caseId, { from: "Quillhaven billing office", perFinding: [{ findingId: gap.id, kind: "needs_more_info", neededDocument: "free T4 lab record", responsibleParty: "Quillhaven laboratory" }] });
  drafted = (await loadCase(bill.caseId)) as CaseView;
  await runCaseAction(bill.caseId, { actionId: "request_document", target: drafted.state.next.target, approve: true });
  sent = (await loadCase(bill.caseId)) as CaseView;
});

afterAll(() => {
  g.__mhStore = undefined;
  for (const [k, v] of [["GEMINI_API_KEY", saved.gemini], ["XAI_API_KEY", saved.xai], ["DEMO_TODAY", saved.today]] as const) {
    if (v) process.env[k] = v;
    else delete process.env[k];
  }
});

describe("parseReply", () => {
  /** Proves every command, casing, punctuation, and the free-text "why" fallback. */
  it.each([
    ["LINK 4f7k2q", { kind: "link", code: "4F7K2Q" }],
    ["  link ABC234 ", { kind: "link", code: "ABC234" }],
    ["A", { kind: "approve" }],
    ["yes!", { kind: "approve" }],
    ["Approve", { kind: "approve" }],
    ["b", { kind: "decline" }],
    ["HOLD", { kind: "decline" }],
    ["why", { kind: "why" }],
    ["WHY 2", { kind: "why", index: 2 }],
    ["why #3?", { kind: "why", index: 3 }],
    ["Why was the free T4 flagged?", { kind: "why", question: "Why was the free T4 flagged" }],
    ["status", { kind: "status" }],
    ["STOP", { kind: "stop" }],
    ["hello there", { kind: "help" }],
    ["", { kind: "help" }],
  ])("parses %j", (text, intent) => {
    expect(parseReply(text)).toEqual(intent);
  });
});

/** Proves link codes are 6 characters with no lookalike characters. */
it("makes link codes without lookalikes", () => {
  for (let i = 0; i < 200; i++) expect(newLinkCode()).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
});

/** Proves long texts keep whole lines, stay within the limit, and always end with the case link. */
it("fits text without cutting lines", () => {
  const lines = ["Title", ...Array.from({ length: 30 }, (_, i) => `Line ${i} ${"x".repeat(40)}`)];
  const text = fit(lines, LINK);
  expect(text.length).toBeLessThanOrEqual(MAX_TEXT_CHARS + 40);
  expect(text.startsWith("Title\n")).toBe(true);
  expect(text.endsWith(`Open your case: ${LINK}`)).toBe(true);
  expect(text).toMatch(/\(\d+ more in the app\)/);
  for (const l of text.split("\n")) expect(lines.includes(l) || l === "" || /more in the app|Open your case/.test(l)).toBe(true);
});

/** Proves reply options are never trimmed away, even when the body overflows. */
it("always keeps the reply options", () => {
  const lines = ["Title", ...Array.from({ length: 40 }, (_, i) => `Line ${i} ${"x".repeat(40)}`)];
  const footer = ["Reply with:", "A → Approve: Request: free T4 lab record", "B → Hold for now (nothing is sent)"];
  const text = fit(lines, LINK, footer);
  for (const l of footer) expect(text).toContain(l);
  expect(text.indexOf("Reply with:")).toBeLessThan(text.indexOf("Open your case"));
});

describe("composers", () => {
  /** Proves the approval update is the card's text with an A/B prompt for the exact action. */
  it("asks for approval only when the card's action needs it", () => {
    const u = composeUpdate(drafted, LINK);
    expect(u.text).toContain(drafted.state.next.title);
    expect(u.text).toContain("Reply with:");
    expect(u.text).toContain("A → Approve: Request: free T4 lab record");
    expect(u.text).toContain("B → Hold for now");
    expect(u.prompt).toEqual({ actionId: "request_document", target: drafted.state.next.target });
    const w = composeUpdate(sent, LINK);
    expect(w.prompt).toBeUndefined();
    expect(w.text).not.toContain("A → Approve");
  });

  /** Proves STATUS numbers every issue so WHY <n> can refer to it. */
  it("lists numbered issues in STATUS", () => {
    const s = composeStatus(drafted, LINK);
    drafted.audit?.findings.forEach((f, i) => expect(s.text).toContain(`${i + 1}. ${f.title}`));
  });

  /**
   * Proves the core rule for "why" answers: apart from fixed wording, every line is the finding's own
   * template string or a `describeSource` citation, so no health fact comes from anywhere else.
   */
  it("builds why answers only from the finding's strings and sources", () => {
    for (const f of drafted.audit?.findings ?? []) {
      const text = composeWhy(drafted, f.id, LINK);
      const allowed = new Set(["", f.title, `Status: ${f.status === "pending" ? "pending" : "potential issue"}`, f.explanation, f.statusNote, ...[...(f.statusSources ?? []), ...f.sources].map((src) => `• ${describeSource(src)}`), "Evidence:", `Open your case: ${LINK}`]);
      const [head, ...rest] = text.split("\n");
      expect(head).toBe("BillLess · Why this was flagged");
      for (const line of rest) expect(allowed.has(line) || /^\(\d+ more in the app\)$/.test(line)).toBe(true);
    }
  });

  /** Proves the documentation-gap answer cites Northstar's record verbatim (the cross-provider moment). */
  it("quotes the Northstar record for the free T4 gap", () => {
    const gap = drafted.audit?.findings.find((f) => f.rule === "documentation_gap");
    expect(gap).toBeDefined();
    const text = composeWhy(drafted, gap!.id, LINK);
    const record = gap!.sources.find((s) => s.kind === "record");
    if (record) expect(text).toContain(describeSource(record));
    expect(text).toContain("Northstar");
  });

  /** Proves free-text questions pick the finding by title words, deterministically. */
  it("matches a free-text question to a finding", () => {
    const fs = drafted.audit?.findings ?? [];
    const gap = fs.find((f) => f.rule === "documentation_gap");
    expect(matchFinding("why was the free T4 flagged", fs)).toBe(gap?.id);
    expect(matchFinding("why is the duplicate there", fs)).toBe(fs.find((f) => f.rule === "duplicate_charge")?.id);
    expect(matchFinding("why", fs)).toBeNull();
  });
});

describe("decideNotify", () => {
  /** Proves a text goes out once per card change and not when nothing meaningful changed. */
  it("fires on card changes only", () => {
    expect(decideNotify(null, drafted)).toBe(true);
    expect(decideNotify(notifySnapshotOf(drafted), drafted)).toBe(false);
    expect(decideNotify(notifySnapshotOf(drafted), sent)).toBe(true);
    expect(decideNotify(notifySnapshotOf(sent), sent)).toBe(false);
  });
});

describe("resolvePrompt", () => {
  const now = new Date("2026-03-24T12:00:00Z");
  /** Builds a prompt for the drafted card. */
  const prompt = (over: Partial<ImessagePrompt> = {}): ImessagePrompt => ({ promptId: "prm_1", actionId: "request_document", target: drafted.state.next.target, expiresAt: "2026-03-25T12:00:00Z", done: false, ...over });

  /** Proves none / done / expired / stale / ok. */
  it("approves only the latest, open, current prompt", () => {
    expect(resolvePrompt([], drafted, now)).toEqual({ ok: false, reason: "none" });
    expect(resolvePrompt([prompt({ done: true })], drafted, now)).toEqual({ ok: false, reason: "done" });
    expect(resolvePrompt([prompt({ expiresAt: "2026-03-24T11:00:00Z" })], drafted, now)).toEqual({ ok: false, reason: "expired" });
    expect(resolvePrompt([prompt({ target: "doc_other" })], drafted, now)).toEqual({ ok: false, reason: "stale" });
    expect(resolvePrompt([prompt()], sent, now)).toEqual({ ok: false, reason: "stale" });
    expect(resolvePrompt([prompt({ promptId: "old" }), prompt()], drafted, now)).toMatchObject({ ok: true, prompt: { promptId: "prm_1" } });
  });
});
