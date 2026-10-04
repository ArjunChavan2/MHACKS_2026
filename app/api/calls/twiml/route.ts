/**
 * @file POST /api/calls/twiml: Twilio fetches this when an outbound call connects (SPEC.md §4.9).
 *
 * Verifies Twilio's signature (only Twilio can start an agent session through this route), asks
 * ElevenLabs to register the call, and returns the TwiML that streams the call audio to the agent.
 * Query parameters become the agent's dynamic variables (set by our code when placing the call).
 */
import { approvedCallVariables } from "@/lib/calls/workspace";
import {
  agentConfig,
  registerAgentCall,
  TWIML_PATH,
  validTwilioSignature,
} from "@/lib/calls";

/** TwiML that ends the call politely when something is wrong. */
const HANGUP =
  '<?xml version="1.0" encoding="UTF-8"?><Response><Say>Sorry, this call could not be connected. Goodbye.</Say><Hangup/></Response>';

/**
 * Returns TwiML for the call.
 *
 * @param req - Twilio's form-encoded request.
 * @returns TwiML (text/xml); 403 when the signature is invalid.
 */
export async function POST(req: Request): Promise<Response> {
  const xml = (body: string, status = 200) =>
    new Response(body, { status, headers: { "Content-Type": "text/xml" } });
  try {
    const cfg = agentConfig();
    const form = Object.fromEntries((await req.formData()).entries()) as Record<
      string,
      string
    >;
    const reqUrl = new URL(req.url);
    // Rebuild the exact URL Twilio was given (APP_URL + path + query); proxies can change host/proto.
    const base = (
      process.env.APP_URL ?? `${reqUrl.protocol}//${reqUrl.host}`
    ).replace(/\/$/, "");
    const signedUrl = `${base}${TWIML_PATH}${reqUrl.search}`;
    if (
      !validTwilioSignature(
        cfg.TWILIO_AUTH_TOKEN,
        signedUrl,
        form,
        req.headers.get("x-twilio-signature"),
      )
    ) {
      return xml(HANGUP, 403);
    }
    const params = Object.fromEntries(reqUrl.searchParams.entries());
    const vars = params.call_session_id
      ? await approvedCallVariables(
          params.case_id ?? "",
          params.call_session_id,
          { sid: form.CallSid ?? "", to: form.To ?? "" },
        )
      : params;
    return xml(await registerAgentCall(cfg, form.To ?? "", vars));
  } catch (err) {
    console.error("calls/twiml:", err instanceof Error ? err.message : err);
    return xml(HANGUP);
  }
}
