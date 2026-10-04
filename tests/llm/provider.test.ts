/**
 * @file Proves the AI provider is chosen correctly and that documents become page images for Grok
 * (SPEC.md §5.1, open decision 15).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { GEMINI_MODEL, GROK_MODEL, LlmUnavailableError, activeModel, defaultClient, llmConfigured, llmProvider } from "@/lib/llm";
import { toPageImages } from "@/lib/llm/pdfPages";

const saved = { ...process.env };
afterEach(() => {
  process.env = { ...saved };
});

/** PNG files start with these 8 bytes. */
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

describe("llmProvider", () => {
  /** Proves Grok is the default only when its key is present, and LLM_PROVIDER overrides it. */
  it("defaults to Grok with an xAI key, Gemini otherwise, and honors LLM_PROVIDER", () => {
    delete process.env.LLM_PROVIDER;
    delete process.env.XAI_API_KEY;
    expect(llmProvider()).toBe("gemini");
    expect(activeModel()).toBe(GEMINI_MODEL);
    process.env.XAI_API_KEY = "test";
    expect(llmProvider()).toBe("grok");
    expect(activeModel()).toBe(GROK_MODEL);
    process.env.LLM_PROVIDER = "gemini";
    expect(llmProvider()).toBe("gemini");
  });
  /** Proves a missing key for the chosen provider fails visibly and names the variable to set. */
  it("reports the missing key for the active provider", () => {
    process.env.LLM_PROVIDER = "grok";
    delete process.env.XAI_API_KEY;
    expect(llmConfigured()).toBe(false);
    expect(() => defaultClient()).toThrow(LlmUnavailableError);
    expect(() => defaultClient()).toThrow("XAI_API_KEY");
  });
});

describe("toPageImages", () => {
  /** Proves a PDF is rendered to one PNG per page, and PNG/JPEG photos pass through unchanged. */
  it("renders PDF pages to PNG and passes images through", async () => {
    const pdf = new Uint8Array(readFileSync(join("fixtures", "documents", "sample-bill.pdf")));
    const pages = await toPageImages({ mimeType: "application/pdf", bytes: pdf });
    expect(pages).toHaveLength(1);
    expect(pages[0].mimeType).toBe("image/png");
    expect([...pages[0].bytes.slice(0, 8)]).toEqual(PNG_MAGIC);
    const photo = await toPageImages({ mimeType: "image/jpg", bytes: pages[0].bytes });
    expect(photo).toEqual([{ mimeType: "image/jpeg", bytes: pages[0].bytes }]);
  });
});
