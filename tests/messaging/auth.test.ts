/**
 * @file Proves which domain case links in texts use (`publicOrigin`): `PUBLIC_APP_URL` first, then
 * `APP_URL`, then the request's own origin, always without a trailing slash.
 */
import { afterEach, describe, expect, it } from "vitest";
import { publicOrigin } from "@/lib/messaging/auth";

const saved = { pub: process.env.PUBLIC_APP_URL, app: process.env.APP_URL };
const req = new Request("https://mhacks-2026.vercel.app/api/messaging/inbound");

afterEach(() => {
  for (const [k, v] of [["PUBLIC_APP_URL", saved.pub], ["APP_URL", saved.app]] as const) {
    if (v) process.env[k] = v;
    else delete process.env[k];
  }
});

describe("publicOrigin", () => {
  /** Proves the patient-facing domain wins over APP_URL and the request host. */
  it("prefers PUBLIC_APP_URL", () => {
    process.env.PUBLIC_APP_URL = "https://billless.tech/";
    process.env.APP_URL = "https://mhacks-2026.vercel.app";
    expect(publicOrigin(req)).toBe("https://billless.tech");
  });

  /** Proves APP_URL is used when PUBLIC_APP_URL is unset or blank. */
  it("falls back to APP_URL", () => {
    process.env.PUBLIC_APP_URL = "  ";
    process.env.APP_URL = "http://localhost:3000/";
    expect(publicOrigin(req)).toBe("http://localhost:3000");
  });

  /** Proves the request's own origin is used when neither is set. */
  it("falls back to the request origin", () => {
    delete process.env.PUBLIC_APP_URL;
    delete process.env.APP_URL;
    expect(publicOrigin(req)).toBe("https://mhacks-2026.vercel.app");
  });
});
