/**
 * @file Retry and timeout policy shared by every model provider (Gemini and Grok).
 *
 * Temporary failures (rate limits, overload, dropped connections, timeouts) are retried with
 * backoff; anything else is passed through unchanged.
 */

/** Thrown when the model provider stays overloaded, rate-limited, or unreachable after retries (`status` 0 = network/timeout). */
export class LlmBusyError extends Error {
  constructor(public readonly status: number) {
    super(`The AI model is temporarily unavailable (${status ? `HTTP ${status}` : "network error or timeout"}).`);
    this.name = "LlmBusyError";
  }
}

/** HTTP statuses worth retrying: rate limits and temporary server overload. */
const RETRYABLE = new Set([429, 500, 503, 504]);

/**
 * Whether an error is a dropped or failed network connection (e.g. ECONNRESET on flaky Wi-Fi).
 *
 * @param err - Thrown value.
 * @returns True for fetch failures, request timeouts (aborts), and common socket error codes.
 */
export function isNetworkError(err: unknown): boolean {
  const codes = new Set(["ECONNRESET", "ETIMEDOUT", "ECONNREFUSED", "EAI_AGAIN", "ENOTFOUND", "UND_ERR_SOCKET", "UND_ERR_CONNECT_TIMEOUT"]);
  const e = err as { name?: string; message?: string; code?: string; cause?: { code?: string } } | null;
  return Boolean(
    e &&
      (e.name === "AbortError" || e.name === "TimeoutError" || e.message === "fetch failed" ||
        codes.has(e.code ?? "") || codes.has(e.cause?.code ?? "")),
  );
}

/** Per-attempt request timeout in milliseconds; a hung request is aborted and retried. */
export const REQUEST_TIMEOUT_MS = 60_000;

/** Backoff delays in milliseconds between retries of a temporary error. */
export const RETRY_DELAYS_MS = [1500, 4000, 9000];

/**
 * Runs a request, retrying temporary model-provider errors with backoff.
 *
 * Side effects: waits between attempts.
 *
 * @param fn - The request.
 * @param delays - Backoff schedule (injectable for tests).
 * @returns The request's result.
 * @throws {LlmBusyError} When every attempt hits a retryable status or network error (status 0 for network).
 * @throws The original error for non-retryable failures.
 */
export async function withRetry<T>(fn: () => Promise<T>, delays: number[] = RETRY_DELAYS_MS): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const status = typeof err === "object" && err !== null && "status" in err ? Number((err as { status: unknown }).status) : NaN;
      if (!RETRYABLE.has(status) && !isNetworkError(err)) throw err;
      if (attempt >= delays.length) throw new LlmBusyError(Number.isNaN(status) ? 0 : status);
      await new Promise((r) => setTimeout(r, delays[attempt]));
    }
  }
}
