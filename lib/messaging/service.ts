/**
 * @file iMessage messaging service (SPEC.md §4.8, §6 MVP 3): the server-side brain behind the Photon
 * worker. Handles an incoming text, computes the outbox of updates, and records sends. The worker
 * only moves text between Photon and these functions (`/api/messaging/*`).
 *
 * State lives as case events (no migration): `imessage_link_code`, `imessage_linked` /
 * `imessage_unlinked` (the only events holding a handle), `imessage_prompt`, `imessage_reply`,
 * `imessage_outbox`, `imessage_superseded`, `imessage_sent`, and `imessage_notified`.
 *
 * Approval rule (SPEC.md §2 rule 5, §4.7): an "A" approves only the exact action and target of the
 * latest prompt, only while that is still the case's allowed next step, and runs it through the same
 * `runCaseAction` gate as the web button. Anything else is refused with the current status.
 */
import { ActionRefusedError, runCaseAction } from "@/lib/cases/caseflow";
import { isConsentPhrase, recordConsent } from "@/lib/cases/consent";
import { answerQuestion, openQuestionOf } from "@/lib/cases/patientQuestions";
import type { ActionId } from "@/lib/cases/machine";
import { loadCase, type CaseView } from "@/lib/cases/service";
import { getStore, newId, type StoredCase } from "@/lib/cases/store";
import {
  PROMPT_TTL_MS,
  caseLink,
  composeHelp,
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
  sameSnapshot,
  type Composed,
  type ImessagePrompt,
  type Intent,
  type NotifySnapshot,
  type PromptRefusal,
} from "./index";

/** One message the worker should send. */
export interface OutboxItem {
  messageId: string;
  handle: string;
  text: string;
}

/** What the case screen's iMessage panel shows. */
export interface ImessageStatus {
  /** Code the patient texts as `LINK <code>`. */
  code: string;
  /** Whether at least one phone is linked. */
  linked: boolean;
  /** The Photon number or handle to text, or `null` when not configured. */
  photonNumber: string | null;
}

/** Stored data of an `imessage_outbox` event. */
interface OutboxEvent {
  messageId: string;
  text: string;
  snapshot: NotifySnapshot;
}

/** Event data of one type, oldest first. */
function eventsOf<T>(c: StoredCase, type: string): T[] {
  return c.events.filter((e) => e.type === type).map((e) => e.data as T);
}

/**
 * The handles currently linked to a case (links minus unlinks, in order).
 *
 * @param c - Stored case.
 * @returns Linked handles.
 */
export function activeHandles(c: StoredCase): string[] {
  const set = new Set<string>();
  for (const e of c.events) {
    const handle = (e.data as { handle?: string } | null)?.handle;
    if (!handle) continue;
    if (e.type === "imessage_linked") set.add(handle);
    if (e.type === "imessage_unlinked") set.delete(handle);
  }
  return [...set];
}

/**
 * The case's prompts with whether each was already approved.
 *
 * @param c - Stored case.
 * @returns Prompts, oldest first.
 */
function promptsOf(c: StoredCase): ImessagePrompt[] {
  const approved = new Set(
    eventsOf<{ promptId?: string; result: string }>(c, "imessage_reply")
      .filter((r) => r.result === "approved" && r.promptId)
      .map((r) => r.promptId),
  );
  const preferenceIndex = c.events.findLastIndex(
    (e) => e.type === "case_preferences_updated",
  );
  return eventsOf<Omit<ImessagePrompt, "done">>(
    { ...c, events: c.events.slice(preferenceIndex + 1) },
    "imessage_prompt",
  ).map((p) => ({ ...p, done: approved.has(p.promptId) }));
}

/**
 * Loads a stored case and its view or throws (the case was found by an event, so it exists).
 *
 * @param caseId - Case ID.
 * @returns Stored case and view.
 */
async function loadBoth(
  caseId: string,
): Promise<{ c: StoredCase; view: CaseView }> {
  const [c, view] = await Promise.all([
    getStore().getCase(caseId),
    loadCase(caseId),
  ]);
  if (!c || !view) throw new Error(`Case ${caseId} disappeared`);
  return { c, view };
}

/**
 * Finds the case a handle is linked to (latest link wins; linking elsewhere unlinks the old case).
 *
 * @param handle - Phone number or email the text came from.
 * @returns Case ID, or `null` when the handle isn't linked.
 */
async function caseForHandle(handle: string): Promise<string | null> {
  const store = getStore();
  let best: { id: string; at: string } | null = null;
  for (const id of await store.findCasesByEvent("imessage_linked", {
    handle,
  })) {
    const c = await store.getCase(id);
    if (!c || !activeHandles(c).includes(handle)) continue;
    const at =
      c.events
        .filter(
          (e) =>
            e.type === "imessage_linked" &&
            (e.data as { handle?: string }).handle === handle,
        )
        .at(-1)?.createdAt ?? "";
    if (!best || at > best.at) best = { id, at };
  }
  return best?.id ?? null;
}

/**
 * Records a composed text as sent to the patient: stores its prompt (if any) and the snapshot, so
 * the outbox doesn't send the same update again.
 *
 * @param caseId - Case ID.
 * @param view - The view the text was composed from.
 * @param composed - The text and optional prompt.
 * @returns The text.
 */
async function deliver(
  caseId: string,
  view: CaseView,
  composed: Composed,
): Promise<string> {
  const store = getStore();
  if (composed.prompt) {
    await store.addEvent(caseId, "imessage_prompt", {
      promptId: newId("prm"),
      ...composed.prompt,
      expiresAt: new Date(Date.now() + PROMPT_TTL_MS).toISOString(),
    });
  }
  await store.addEvent(caseId, "imessage_notified", {
    snapshot: notifySnapshotOf(view),
    via: "reply",
  });
  return composed.text;
}

/** Plain explanation for each refused "A". */
const REFUSAL_TEXT: Record<PromptRefusal, string> = {
  none: "Nothing is waiting for your approval.",
  done: "Already done. Nothing else was sent.",
  expired: "That choice expired. Nothing was sent.",
  stale: "That choice is no longer available. Nothing was sent.",
};

/**
 * Handles `LINK <code>`: links the handle to the case with that code, unlinking any other case.
 *
 * @param handle - Sender handle.
 * @param code - Link code.
 * @param baseUrl - Deployment origin for links.
 * @returns The reply.
 */
async function link(
  handle: string,
  code: string,
  baseUrl: string,
): Promise<string> {
  const store = getStore();
  const [caseId] = await store.findCasesByEvent("imessage_link_code", { code });
  if (!caseId)
    return "That code didn't match a case. Check the code on your case screen and text LINK <code> again.";
  const previous = await caseForHandle(handle);
  if (previous && previous !== caseId)
    await store.addEvent(previous, "imessage_unlinked", {
      handle,
      reason: "linked another case",
    });
  if (previous !== caseId)
    await store.addEvent(caseId, "imessage_linked", { handle });
  await store.addEvent(caseId, "imessage_reply", {
    intent: "link",
    result: "linked",
  });
  const { view } = await loadBoth(caseId);
  const update = composeUpdate(view, caseLink(baseUrl, caseId));
  return deliver(caseId, view, {
    ...update,
    text: `Linked. You'll get updates about this case here.\n\n${update.text}`,
  });
}

/**
 * Runs the action of the latest prompt after an "A", through the same gate as the web button.
 *
 * @param caseId - Case ID.
 * @param c - Stored case.
 * @param view - Case view.
 * @param link - Case link.
 * @returns The reply.
 */
async function approve(
  caseId: string,
  c: StoredCase,
  view: CaseView,
  link: string,
): Promise<string> {
  const store = getStore();
  const r = resolvePrompt(promptsOf(c), view, new Date());
  if (!r.ok) {
    await store.addEvent(caseId, "imessage_reply", {
      intent: "approve",
      result: r.reason,
    });
    const update = composeUpdate(view, link);
    return deliver(caseId, view, {
      ...update,
      text: `${REFUSAL_TEXT[r.reason]}\n\n${update.text}`,
    });
  }
  const { actionId, target, promptId } = r.prompt;
  const label =
    view.state.allowed.find(
      (a) =>
        a.id === actionId && (a.target ?? undefined) === (target ?? undefined),
    )?.label ?? actionId;
  try {
    await runCaseAction(caseId, {
      actionId: actionId as ActionId,
      ...(target ? { target } : {}),
      approve: true,
    });
  } catch (err) {
    if (!(err instanceof ActionRefusedError)) throw err;
    await store.addEvent(caseId, "imessage_reply", {
      intent: "approve",
      promptId,
      result: "stale",
    });
    const update = composeUpdate(view, link);
    return deliver(caseId, view, {
      ...update,
      text: `${REFUSAL_TEXT.stale}\n\n${update.text}`,
    });
  }
  await store.addEvent(caseId, "imessage_reply", {
    intent: "approve",
    promptId,
    result: "approved",
  });
  const after = await loadBoth(caseId);
  const update = composeUpdate(after.view, link);
  return deliver(caseId, after.view, {
    ...update,
    text: `Done: ${label}. (Recorded with your approval; sending is simulated in this demo.)\n\n${update.text}`,
  });
}

/**
 * Answers a "why" question from the finding's own text and sources.
 *
 * @param view - Case view.
 * @param intent - The why intent (index or question).
 * @param link - Case link.
 * @returns The reply.
 */
function why(
  view: CaseView,
  intent: Extract<Intent, { kind: "why" }>,
  link: string,
): string {
  const findings = view.audit?.findings ?? [];
  if (!findings.length)
    return fit(["No issues were flagged on this case."], link);
  if (intent.index !== undefined) {
    const f = findings[intent.index - 1];
    return f
      ? composeWhy(view, f.id, link)
      : fit(
          [
            `There is no issue ${intent.index}. Text STATUS for the numbered list.`,
          ],
          link,
        );
  }
  const fallback =
    view.state.next.citedFindingIds[0] ??
    findings.find((f) => f.status !== "withdrawn")?.id ??
    findings[0].id;
  const id =
    (intent.question ? matchFinding(intent.question, findings) : null) ??
    fallback;
  return composeWhy(view, id, link);
}

/**
 * Handles one incoming text and returns the reply. Never throws for bad input: unknown handles get
 * linking instructions, and unknown commands get HELP.
 *
 * @param handle - Phone number or email the text came from (stored only in link events).
 * @param text - Message text.
 * @param baseUrl - Deployment origin for case links.
 * @returns The reply to send back.
 */
export async function handleInbound(
  handle: string,
  text: string,
  baseUrl: string,
): Promise<string> {
  const store = getStore();
  const intent = parseReply(text);
  if (intent.kind === "link") return link(handle, intent.code, baseUrl);
  const caseId = await caseForHandle(handle);
  if (!caseId)
    return "This number isn't linked to a case yet. Open your case on the web and text the LINK code it shows, e.g. LINK 4F7K2Q.";
  if (isConsentPhrase(text)) {
    await recordConsent(caseId, text, "imessage");
    await store.addEvent(caseId, "imessage_reply", {
      intent: "consent",
      result: "recorded",
    });
    const asked = (await store.getCase(caseId))?.events.filter((e) => e.type === "consent_requested").at(-1);
    const who = (asked?.data as { counterparty?: string } | undefined)?.counterparty || "the office";
    return `Thanks. Billy will tell ${who} you consent to him representing you.`;
  }
  const { c, view } = await loadBoth(caseId);
  // While Billy is waiting on a question from a live call, the patient's next text is the answer
  // (even "yes" or "A"); only STOP keeps its meaning.
  const question = intent.kind === "stop" ? null : openQuestionOf(c);
  if (question) return answerQuestion(caseId, question, text);
  const url = caseLink(baseUrl, caseId);
  switch (intent.kind) {
    case "approve":
      return approve(caseId, c, view, url);
    case "decline": {
      const r = resolvePrompt(promptsOf(c), view, new Date());
      await store.addEvent(caseId, "imessage_reply", {
        intent: "decline",
        ...(r.ok ? { promptId: r.prompt.promptId } : {}),
        result: r.ok ? "declined" : r.reason,
      });
      return r.ok
        ? fit(
            ["Okay, holding. Nothing was sent.", "Reply A any time to approve it."],
            url,
          )
        : fit([REFUSAL_TEXT[r.reason]], url);
    }
    case "why":
      await store.addEvent(caseId, "imessage_reply", {
        intent: "why",
        result: "answered",
      });
      return why(view, intent, url);
    case "status":
      await store.addEvent(caseId, "imessage_reply", {
        intent: "status",
        result: "answered",
      });
      return deliver(caseId, view, composeStatus(view, url));
    case "stop": {
      await store.addEvent(caseId, "imessage_unlinked", {
        handle,
        reason: "patient texted STOP",
      });
      const code = eventsOf<{ code: string }>(c, "imessage_link_code").at(
        -1,
      )?.code;
      return `You won't get more texts about this case.${code ? ` Text LINK ${code} to turn them back on.` : ""}`;
    }
    case "help":
      return composeHelp(url);
  }
}

/**
 * Computes the messages the worker should send now: for each linked case whose state changed enough
 * (`decideNotify`), one update per linked handle. A pending, unsent update is reused while the state
 * is unchanged and superseded when it changes, so a restarted worker sends only the latest card.
 *
 * @param baseUrl - Deployment origin for case links.
 * @returns Messages to send (one per handle; handles of one case share a message ID).
 */
export async function pendingOutbox(baseUrl: string): Promise<OutboxItem[]> {
  const store = getStore();
  const out: OutboxItem[] = [];
  for (const caseId of await store.findCasesByEvent("imessage_linked", {})) {
    const c = await store.getCase(caseId);
    if (!c) continue;
    const handles = activeHandles(c);
    if (!handles.length) continue;
    const view = await loadCase(caseId);
    if (!view) continue;
    const sent = new Set(
      [
        ...eventsOf<{ messageId: string }>(c, "imessage_sent"),
        ...eventsOf<{ messageId: string }>(c, "imessage_superseded"),
      ].map((e) => e.messageId),
    );
    const pending = eventsOf<OutboxEvent>(c, "imessage_outbox").filter(
      (o) => !sent.has(o.messageId),
    );
    const last =
      eventsOf<{ snapshot: NotifySnapshot }>(c, "imessage_notified").at(-1)
        ?.snapshot ?? null;
    let current = pending.at(-1) ?? null;
    if (decideNotify(last, view)) {
      const snap = notifySnapshotOf(view);
      if (!current || !sameSnapshot(current.snapshot, snap)) {
        for (const p of pending)
          await store.addEvent(caseId, "imessage_superseded", {
            messageId: p.messageId,
          });
        const composed = composeUpdate(view, caseLink(baseUrl, caseId));
        if (composed.prompt) {
          await store.addEvent(caseId, "imessage_prompt", {
            promptId: newId("prm"),
            ...composed.prompt,
            expiresAt: new Date(Date.now() + PROMPT_TTL_MS).toISOString(),
          });
        }
        current = {
          messageId: newId("msg"),
          text: composed.text,
          snapshot: snap,
        };
        await store.addEvent(caseId, "imessage_outbox", current);
      }
    } else if (current) {
      // The state went back to what was last sent; the pending update is no longer news.
      await store.addEvent(caseId, "imessage_superseded", {
        messageId: current.messageId,
      });
      current = null;
    }
    if (current)
      for (const handle of handles)
        out.push({ messageId: current.messageId, handle, text: current.text });
    // Direct messages (e.g. a consent request during a live call) are always delivered, never superseded.
    for (const d of eventsOf<{ messageId: string; text: string }>(
      c,
      "imessage_direct",
    ).filter((m) => !sent.has(m.messageId))) {
      for (const handle of handles)
        out.push({ messageId: d.messageId, handle, text: d.text });
    }
  }
  return out;
}

/**
 * Marks an outbox message as sent and records its snapshot. Idempotent.
 *
 * @param messageId - Outbox message ID.
 * @returns True if the message exists.
 */
export async function ack(messageId: string): Promise<boolean> {
  const store = getStore();
  const [direct] = await store.findCasesByEvent("imessage_direct", {
    messageId,
  });
  if (direct) {
    const dc = await store.getCase(direct);
    if (
      dc &&
      !eventsOf<{ messageId: string }>(dc, "imessage_sent").some(
        (e) => e.messageId === messageId,
      )
    )
      await store.addEvent(direct, "imessage_sent", { messageId });
    return true;
  }
  const [caseId] = await store.findCasesByEvent("imessage_outbox", {
    messageId,
  });
  if (!caseId) return false;
  const c = await store.getCase(caseId);
  const msg = c
    ? eventsOf<OutboxEvent>(c, "imessage_outbox").find(
        (o) => o.messageId === messageId,
      )
    : undefined;
  if (!c || !msg) return false;
  if (
    eventsOf<{ messageId: string }>(c, "imessage_sent").some(
      (e) => e.messageId === messageId,
    )
  )
    return true;
  await store.addEvent(caseId, "imessage_sent", { messageId });
  await store.addEvent(caseId, "imessage_notified", {
    snapshot: msg.snapshot,
    messageId,
    via: "outbox",
  });
  return true;
}

/**
 * Returns the case's link code (creating it on first use) and whether a phone is linked.
 *
 * @param caseId - Case ID.
 * @returns Status for the case screen, or `null` for an unknown case.
 */
export async function imessageStatus(
  caseId: string,
): Promise<ImessageStatus | null> {
  const store = getStore();
  const c = await store.getCase(caseId);
  if (!c) return null;
  let code = eventsOf<{ code: string }>(c, "imessage_link_code").at(-1)?.code;
  if (!code) {
    code = newLinkCode();
    await store.addEvent(caseId, "imessage_link_code", { code });
  }
  return {
    code,
    linked: activeHandles(c).length > 0,
    photonNumber: process.env.PHOTON_NUMBER?.trim() || null,
  };
}
