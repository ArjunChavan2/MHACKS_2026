/**
 * @file Grok (xAI) client behind the shared `LlmClient` interface (SPEC.md §5.1).
 *
 * Grok reads images, not PDFs, so each file is sent as page images (`./pdfPages.ts`), labeled
 * "Page N" so the model can report page numbers. Only the images are sent, never the PDF text layer,
 * so the text-layer cross-check stays independent of what the model read (SPEC.md §4.2 step 4).
 * Replies are constrained to the JSON schema (`response_format: json_schema`, strict).
 */
import type { LlmClient } from "./index";
import { GROK_MODEL, LlmUnavailableError } from "./index";
import { toPageImages } from "./pdfPages";
import { REQUEST_TIMEOUT_MS, withRetry } from "./retry";

/** xAI's OpenAI-compatible chat completions endpoint. */
export const XAI_CHAT_URL = "https://api.x.ai/v1/chat/completions";

/** One part of a chat message: text or an image. */
type ContentPart = { type: "text"; text: string } | { type: "image_url"; image_url: { url: string; detail: "high" } };

/**
 * Creates the Grok client.
 *
 * Temporary errors (429/5xx, network failures, timeouts) are retried with backoff (`withRetry`).
 *
 * @returns An `LlmClient` backed by the xAI API.
 * @throws {LlmUnavailableError} When `XAI_API_KEY` is not set.
 */
export function grokClient(): LlmClient {
  const apiKey = process.env.XAI_API_KEY;
  if (!apiKey) throw new LlmUnavailableError("XAI_API_KEY");
  return {
    async complete(args) {
      const content: ContentPart[] = [{ type: "text", text: args.prompt }];
      let page = 0;
      for (const file of args.files ?? []) {
        for (const img of await toPageImages(file)) {
          page++;
          content.push({ type: "text", text: `Page ${page}:` });
          const url = `data:${img.mimeType};base64,${Buffer.from(img.bytes).toString("base64")}`;
          content.push({ type: "image_url", image_url: { url, detail: "high" } });
        }
      }
      const body = JSON.stringify({
        model: GROK_MODEL,
        temperature: args.temperature ?? 0,
        messages: [
          { role: "system", content: args.system },
          { role: "user", content },
        ],
        response_format: { type: "json_schema", json_schema: { name: "reply", strict: true, schema: args.jsonSchema } },
      });
      const json = await withRetry(async () => {
        const res = await fetch(XAI_CHAT_URL, {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
          body,
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
        if (!res.ok) {
          const detail = (await res.text()).slice(0, 500);
          throw Object.assign(new Error(`xAI request failed (HTTP ${res.status}): ${detail}`), { status: res.status });
        }
        return (await res.json()) as { choices?: Array<{ message?: { content?: string | null } }> };
      });
      return json.choices?.[0]?.message?.content ?? "";
    },
  };
}
