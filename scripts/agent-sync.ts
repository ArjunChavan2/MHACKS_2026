/**
 * @file Pushes Billy's prompts and tools to both ElevenLabs agents (MVP 4), so the dashboard matches
 * the repo. Run with `npm run agent:sync`.
 *
 * - Billing agent: stored prompt + first message = the per-call brief for the Priya demo case
 *   (`buildCallBrief`), so simulated tests (`npm run agent:test`) use the same rules live calls get
 *   from `/api/calls/brief`.
 * - Insurer agent: prompt = `agent-notes/mvp4-call/insurer-prompt.txt`.
 * - Tools: `request_patient_consent` and `ask_patient` webhooks on both agents, with forced
 *   pre-tool speech so Billy always tells the person on the line before texting the patient.
 *
 * Reads ELEVENLABS_API_KEY, ELEVENLABS_AGENT_ID, ELEVENLABS_INSURER_AGENT_ID, MESSAGING_SECRET from
 * `.env.local`. Never prints the secret.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { findBillExceedsEob, findDocumentationGaps, findDuplicateCharges } from "@/lib/audit/rules";
import { buildCallBrief } from "@/lib/calls/brief";
import { getRecords, providersOf } from "@/lib/finchnode";
import { confirmedSampleBill, confirmedSampleEob } from "../tests/helpers";

const API = "https://api.elevenlabs.io/v1/convai";
/** Where the webhook tools call (same deployment as billless.tech). */
const APP = "https://billless.tech";

/** Reads a required environment variable. */
function need(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Set ${name} in .env.local`);
  return v;
}

/** One ElevenLabs API call; throws with the response body on failure. */
async function el(path: string, init: RequestInit = {}): Promise<unknown> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { "xi-api-key": need("ELEVENLABS_API_KEY"), "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
  if (!res.ok) throw new Error(`${init.method ?? "GET"} ${path}: HTTP ${res.status} ${(await res.text()).slice(0, 400)}`);
  return res.json();
}

/** A string body parameter. */
function param(description: string) {
  return { type: "string", description, dynamic_variable: "", constant_value: "", is_system_provided: false };
}

/** Webhook tool configs, keyed by name. */
function toolConfigs(secret: string) {
  const common = {
    type: "webhook",
    response_timeout_secs: 55,
    force_pre_tool_speech: true,
    disable_interruptions: false,
  };
  return {
    request_patient_consent: {
      ...common,
      name: "request_patient_consent",
      description:
        "Text the patient to confirm they consent to Billy representing them. Use at the start of every call, right after the other side confirms who they are. Before using it, tell the person on the line you're texting the patient and it can take up to a minute. Waits up to about 40 seconds and returns whether they consented.",
      api_schema: {
        url: `${APP}/api/calls/consent`,
        method: "POST",
        request_headers: { "x-billy-secret": secret },
        request_body_schema: {
          type: "object",
          description: "Who is asking for consent.",
          required: ["counterparty"],
          properties: { counterparty: param("Who you're speaking with, e.g. Quillhaven Medical Group's billing office") },
        },
      },
    },
    ask_patient: {
      ...common,
      name: "ask_patient",
      description:
        "Ask the patient by text for a detail you don't have (date of birth, member ID, address). Before using it, tell the person on the line you're texting the patient and it can take up to a minute. Returns the patient's reply verbatim, or that nothing may be shared.",
      api_schema: {
        url: `${APP}/api/calls/ask`,
        method: "POST",
        request_headers: { "x-billy-secret": secret },
        request_body_schema: {
          type: "object",
          description: "The question to text the patient.",
          required: ["question"],
          properties: {
            question: param("The question as the office asked it"),
            counterparty: param("Who is asking, e.g. Quillhaven Medical Group's billing office"),
          },
        },
      },
    },
  };
}

/** Creates or updates each tool by name; returns their IDs. */
async function syncTools(secret: string): Promise<string[]> {
  const existing = ((await el("/tools")) as { tools?: Array<{ id: string; tool_config: { name: string } }> }).tools ?? [];
  const ids: string[] = [];
  for (const [name, config] of Object.entries(toolConfigs(secret))) {
    const found = existing.find((t) => t.tool_config.name === name);
    if (found) {
      await el(`/tools/${found.id}`, { method: "PATCH", body: JSON.stringify({ tool_config: config }) });
      console.log(`tool ${name}: updated (${found.id})`);
      ids.push(found.id);
    } else {
      const made = (await el("/tools", { method: "POST", body: JSON.stringify({ tool_config: config }) })) as { id: string };
      console.log(`tool ${name}: created (${made.id})`);
      ids.push(made.id);
    }
  }
  return ids;
}

/** The billing brief for the Priya demo case, from the same code as live calls. */
async function priyaBrief(): Promise<{ prompt: string; firstMessage: string }> {
  const bill = await confirmedSampleBill();
  const eob = await confirmedSampleEob();
  const records = getRecords();
  const findings = [...findDuplicateCharges(bill), ...findBillExceedsEob(bill, eob), ...findDocumentationGaps(bill, records, providersOf(records))];
  const brief = buildCallBrief(bill, eob, findings);
  if (!brief) throw new Error("No brief for the demo case");
  return brief;
}

/** Sets an agent's prompt, tools, and (optionally) first message. */
async function syncAgent(label: string, agentId: string, prompt: string, toolIds: string[], firstMessage?: string): Promise<void> {
  const agent = { prompt: { prompt, tool_ids: toolIds }, ...(firstMessage ? { first_message: firstMessage } : {}) };
  await el(`/agents/${agentId}`, { method: "PATCH", body: JSON.stringify({ conversation_config: { agent } }) });
  const check = (await el(`/agents/${agentId}`)) as { conversation_config: { agent: { prompt: { prompt: string; tool_ids: string[] } } } };
  const p = check.conversation_config.agent.prompt;
  console.log(`${label} agent: prompt ${p.prompt.length} chars, tools ${JSON.stringify(p.tool_ids)}`);
}

/** Syncs tools and both agents. */
async function main(): Promise<void> {
  const toolIds = await syncTools(need("MESSAGING_SECRET"));
  const billing = await priyaBrief();
  await syncAgent("billing", need("ELEVENLABS_AGENT_ID"), billing.prompt, toolIds, billing.firstMessage);
  const insurerPrompt = readFileSync(join(process.cwd(), "agent-notes", "mvp4-call", "insurer-prompt.txt"), "utf8");
  await syncAgent("insurer", need("ELEVENLABS_INSURER_AGENT_ID"), insurerPrompt, toolIds);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

export {};
