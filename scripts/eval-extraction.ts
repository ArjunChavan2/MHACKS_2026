/**
 * @file Live extraction eval (SPEC.md §5.7): runs real Gemini extraction on each fixture PDF and
 * compares every field's raw value with the expected reply, field by field.
 *
 * Uses the active provider (`LLM_PROVIDER`; Grok when `XAI_API_KEY` is set, else Gemini) and needs
 * its key. Run with `npm run eval:extraction`; `LLM_PROVIDER=gemini npm run eval:extraction` for Gemini. Prints per-document accuracy and
 * every mismatch; exits non-zero if any field differs. The prompt-injection bill must still report
 * the printed amount due. Add the scanned-PDF and phone-photo variants to `CASES` once someone
 * prints and photographs the sample bill (they need the same expected reply as `sample-bill`).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { extractDocument } from "../lib/extract/pipeline";
import { billFields, eobFields } from "../lib/extract/checks";
import { parseCodeType, parseProviderType } from "../lib/extract/normalize";

/** Fixture documents and the expected reply each should produce. */
const CASES: Array<{ file: string; mime: string; expected: string }> = [
  { file: "sample-bill.pdf", mime: "application/pdf", expected: "sample-bill" },
  { file: "sample-eob.pdf", mime: "application/pdf", expected: "sample-eob" },
  { file: "balance-statement.pdf", mime: "application/pdf", expected: "balance-statement" },
  { file: "bill-broken-totals.pdf", mime: "application/pdf", expected: "bill-broken-totals" },
  { file: "bill-injection.pdf", mime: "application/pdf", expected: "bill-injection" },
  { file: "revised-statement.pdf", mime: "application/pdf", expected: "revised-statement" },
];

/**
 * Flattens an expected raw reply into `path → raw` pairs.
 *
 * @param node - Expected reply (or part of it).
 * @param prefix - Path so far.
 * @param out - Accumulator.
 * @returns The accumulator.
 */
function flatten(node: unknown, prefix = "", out: Record<string, string | null> = {}): Record<string, string | null> {
  if (node && typeof node === "object" && "status" in node && "raw" in node) {
    out[prefix] = (node as { raw: string | null }).raw;
    return out;
  }
  if (Array.isArray(node)) node.forEach((n, i) => flatten(n, `${prefix}${prefix ? "." : ""}${i}`, out));
  else if (node && typeof node === "object")
    for (const [k, v] of Object.entries(node)) if (k !== "docType") flatten(v, `${prefix}${prefix ? "." : ""}${k}`, out);
  return out;
}

/**
 * Normalizes whitespace for comparison.
 *
 * @param s - Raw value.
 * @returns Comparable value.
 */
const norm = (s: string | null) => (s === null ? null : s.replace(/\s+/g, " ").trim());

/**
 * Whether a path is a model-assigned label rather than printed text.
 *
 * @param path - Field path.
 * @returns True for code type and provider type.
 */
const isLabel = (path: string) => path.endsWith("codeType") || path.endsWith("providerType");

/**
 * Normalizes an expected label the same way the pipeline does.
 *
 * @param path - Field path.
 * @param raw - Expected raw label.
 * @returns The normalized label, or `null`.
 */
const labelValue = (path: string, raw: string | null) =>
  raw === null ? null : path.endsWith("codeType") ? parseCodeType(raw) : parseProviderType(raw);

/**
 * Runs the eval.
 *
 * @returns Resolves when done; sets a non-zero exit code on any mismatch.
 */
async function main(): Promise<void> {
  let failures = 0;
  for (const c of CASES) {
    const bytes = new Uint8Array(readFileSync(join("fixtures", "documents", c.file)));
    const expected = flatten(JSON.parse(readFileSync(join("fixtures", "llm-output", `${c.expected}.json`), "utf8")));
    const r = await extractDocument({ mimeType: c.mime, bytes });
    if (r.kind === "unsupported") {
      console.log(`✗ ${c.file}: classified as ${r.docType} (${r.reason})`);
      failures++;
      continue;
    }
    const fields = r.kind === "bill" ? billFields(r.bill) : eobFields(r.eob);
    const got = Object.fromEntries(fields.map(([p, f]) => [p, f]));
    const keys = Object.keys(expected);
    // Labels (code type, provider type) aren't printed text, so compare normalized values for them.
    const value = (k: string) => (isLabel(k) ? (got[k]?.value as string | null) ?? null : norm(got[k]?.raw ?? null));
    const want = (k: string) => (isLabel(k) ? labelValue(k, expected[k]) : norm(expected[k]));
    const wrong = keys.filter((k) => want(k) !== value(k));
    failures += wrong.length;
    console.log(`${wrong.length ? "✗" : "✓"} ${c.file}: ${keys.length - wrong.length}/${keys.length} fields match`);
    for (const k of wrong) console.log(`    ${k}: expected ${JSON.stringify(want(k))}, got ${JSON.stringify(value(k))}`);
  }
  if (failures) process.exitCode = 1;
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
