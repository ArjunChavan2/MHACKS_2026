/**
 * @file Proves the TwiML route's Twilio signature check matches Twilio's official algorithm
 * (signature below was produced and accepted by the `twilio` package's `validateRequest`).
 */
import { describe, expect, it } from "vitest";
import { validTwilioSignature } from "@/lib/calls";

const TOKEN = "test_auth_token_123";
const URL_ = "https://mhacks-2026.vercel.app/api/calls/twiml?patient_name=Priya+Ramaswamy&account_number=QMG-305518";
const PARAMS = { CallSid: "CA123", From: "+17349770915", To: "+15555550123", AccountSid: "AC123", Direction: "outbound-api" };
const OFFICIAL = "ZjG8NoPUcelwN1ggiluV3r0NftA=";

describe("validTwilioSignature", () => {
  /** Proves a signature Twilio's own library accepts is accepted here, and tampering is rejected. */
  it("matches Twilio's algorithm and rejects tampering", () => {
    expect(validTwilioSignature(TOKEN, URL_, PARAMS, OFFICIAL)).toBe(true);
    expect(validTwilioSignature(TOKEN, URL_, { ...PARAMS, To: "+15550000000" }, OFFICIAL)).toBe(false);
    expect(validTwilioSignature(TOKEN, `${URL_}&x=1`, PARAMS, OFFICIAL)).toBe(false);
    expect(validTwilioSignature("wrong_token", URL_, PARAMS, OFFICIAL)).toBe(false);
    expect(validTwilioSignature(TOKEN, URL_, PARAMS, null)).toBe(false);
  });
});
