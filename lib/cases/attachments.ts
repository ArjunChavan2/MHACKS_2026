/**
 * @file Patient document attachment and resumption (SPEC.md §3.6, §4.2, §4.6).
 * Only supported confirmed administrative documents can change case state; no clinical inference.
 */
import type { CaseTask, ConfirmedBill, ConfirmedEob } from "@/lib/types";
import { snapshotOf } from "./caseflow";
import { sameAccount, sameName } from "./consistency";
import { REVISED_STATEMENT, CaseRuleError } from "./responses";
import { auditCase } from "./service";
import { getStore, type StoredCase, type StoredDocument } from "./store";

/**
 * Normalizes administrative identifiers for comparison, never medical content.
 * @param value - Printed name or identifier.
 * @returns Lowercase text with collapsed whitespace, or empty for missing identifiers. Pure.
 */
function identifier(value: string | null): string {
  return value?.trim().toLowerCase().replace(/\s+/g, " ") ?? "";
}

/**
 * Checks a revision belongs to the original account and service before savings verification.
 * @param original - Patient-confirmed original bill.
 * @param revised - Patient-confirmed revised statement.
 * @throws {CaseRuleError} When identity is mismatched or insufficient, or totals are unreliable.
 * Pure; never computes findings or changes either document.
 */
export function assertMatchingRevision(
  original: ConfirmedBill,
  revised: ConfirmedBill,
): void {
  if (
    !identifier(original.billingEntity) ||
    !sameName(original.billingEntity, revised.billingEntity) ||
    !original.accountNumber ||
    !revised.accountNumber ||
    // A masked account ("****5518") matches when its visible tail (4+ characters) ends the original.
    !sameAccount(original.accountNumber, revised.accountNumber) ||
    !original.patientName ||
    !revised.patientName ||
    !sameName(original.patientName, revised.patientName) ||
    !original.serviceStart ||
    original.serviceStart !== revised.serviceStart ||
    original.serviceEnd !== revised.serviceEnd ||
    (original.encounter &&
      revised.encounter &&
      identifier(original.encounter) !== identifier(revised.encounter))
  ) {
    throw new CaseRuleError(
      "This statement does not match the original provider, patient, account and service dates. Please check the document or handle it with the billing office.",
    );
  }
  if (
    original.amountDueCents === null ||
    original.totalsMismatchAcknowledged ||
    revised.amountDueCents === null ||
    revised.totalsMismatchAcknowledged
  ) {
    throw new CaseRuleError(
      "Statements with missing or conflicting totals cannot verify savings. Ask for a corrected statement.",
    );
  }
}

/**
 * Requires a confirmed EOB from the same provider with matching coded service dates.
 * @param bill - Confirmed original bill.
 * @param eob - Confirmed insurance explanation.
 * @throws {CaseRuleError} For a provider or service mismatch, including absent identifying fields.
 * Pure; conservative matching because the current EOB schema has no patient/account identifier.
 */
function assertMatchingEob(bill: ConfirmedBill, eob: ConfirmedEob): void {
  if (
    !eob.provider ||
    !sameName(eob.provider, bill.billingEntity) ||
    !eob.lines.length ||
    !eob.lines.every(
      (line) =>
        line.code &&
        line.serviceDate &&
        bill.lines.some(
          (b) => b.code === line.code && b.serviceDate === line.serviceDate,
        ),
    )
  ) {
    throw new CaseRuleError(
      "This EOB does not match the original provider and coded service dates. Please check the document before continuing.",
    );
  }
}

/**
 * Determines whether a task can be fulfilled by one of the supported administrative types.
 * @param task - Pending task.
 * @param docType - Actual classified document type.
 * @returns Whether the exact task description maps to that type. Pure, no model interpretation.
 */
export function taskAcceptsDocument(task: CaseTask, docType: string): boolean {
  const needed = identifier(task.documentNeeded);
  return (
    (docType === "revised_statement" && needed === REVISED_STATEMENT) ||
    (docType === "eob" &&
      [
        "eob",
        "explanation of benefits",
        "insurance explanation of benefits",
      ].includes(needed))
  );
}

/**
 * Validates a confirmed attachment before any task or finding changes.
 * @param c - Case owning the document.
 * @param doc - Candidate document, optionally with newly confirmed values.
 * @throws {CaseRuleError} For a missing original, foreign document, second bill, or mismatch.
 * Pure; an original bill can be added only when the case has no confirmed original yet.
 */
export function validateCaseDocument(c: StoredCase, doc: StoredDocument): void {
  if (doc.caseId !== c.id)
    throw new CaseRuleError("That document is not on this case.");
  const originals = c.documents.filter(
    (d) => d.docType === "itemized_bill" && d.confirmed && d.id !== doc.id,
  );
  if (originals.length > 1)
    throw new CaseRuleError(
      "This case contains several bills. A human must select the original.",
    );
  const original = originals[0]?.confirmed as ConfirmedBill | undefined;
  if (doc.docType === "itemized_bill") {
    if (original)
      throw new CaseRuleError(
        "This case already has an original bill. Add a revised statement or start a separate review.",
      );
    return;
  }
  if (!original)
    throw new CaseRuleError(
      "Confirm an original itemized bill before adding an EOB or revised statement to case tracking.",
    );
  if (!doc.confirmed) return;
  if (doc.docType === "revised_statement")
    assertMatchingRevision(original, doc.confirmed as ConfirmedBill);
  else if (doc.docType === "eob")
    assertMatchingEob(original, doc.confirmed as ConfirmedEob);
  else
    throw new CaseRuleError(
      "Case tracking supports itemized bills, EOBs and revised statements. Other records need human handling.",
    );
}

/**
 * Registers an already ingested document on its own case, optionally for a supported pending task.
 * Idempotent for the same document/task; receipt alone never fulfills the task.
 * @param caseId - Existing case ID.
 * @param documentId - Stored incoming document on that case.
 * @param taskId - Optional open task chosen by the patient.
 * @throws {CaseRuleError} For foreign IDs, unsupported types, stale tasks or changed associations.
 * Side effects: appends the attachment association, then resumes checks only if already confirmed.
 */
export async function attachCaseDocument(
  caseId: string,
  documentId: string,
  taskId?: string,
): Promise<void> {
  const store = getStore();
  const c = await store.getCase(caseId);
  const doc = c?.documents.find(
    (d) => d.id === documentId && d.direction === "incoming",
  );
  if (!c || !doc) throw new CaseRuleError("That document is not on this case.");
  if (!["itemized_bill", "eob", "revised_statement"].includes(doc.docType))
    throw new CaseRuleError(
      "This document type needs human handling. Add an itemized bill, EOB or revised statement here.",
    );
  const prior = c.events
    .filter((e) => e.type === "case_document_attached")
    .map((e) => e.data as { documentId: string; taskId?: string })
    .find((e) => e.documentId === documentId);
  if (prior && prior.taskId !== taskId)
    throw new CaseRuleError(
      "This document is already attached to another task.",
    );
  if (!prior && taskId) {
    const task = snapshotOf(c).tasks.find(
      (t) => t.id === taskId && t.status !== "done",
    );
    if (!task || !taskAcceptsDocument(task, doc.docType))
      throw new CaseRuleError(
        "This document cannot fulfill that task. Add the requested document or handle this task yourself.",
      );
  }
  validateCaseDocument(c, doc);
  if (!prior)
    await store.addEvent(caseId, "case_document_attached", {
      documentId,
      ...(taskId ? { taskId } : {}),
    });
  if (doc.confirmed) await resumeCaseDocument(caseId, documentId);
}

/**
 * Reruns supported checks for a registered, confirmed arrival and fulfills its matching EOB task.
 * @param caseId - Owning case.
 * @param documentId - Confirmed registered document.
 * @throws {CaseRuleError} For unsupported/mismatched evidence or a stale task.
 * Side effects: re-audits original/EOB, preserves finding statuses, records completed checks/tasks.
 * Revised statements are verified by the existing confirmation service before this function.
 */
export async function resumeCaseDocument(
  caseId: string,
  documentId: string,
): Promise<void> {
  const store = getStore();
  const c = await store.getCase(caseId);
  if (!c) throw new CaseRuleError("Unknown case");
  const association = c.events
    .filter((e) => e.type === "case_document_attached")
    .map((e) => e.data as { documentId: string; taskId?: string })
    .find((e) => e.documentId === documentId);
  if (
    !association ||
    c.events.some(
      (e) =>
        e.type === "case_document_checked" &&
        (e.data as { documentId: string }).documentId === documentId,
    )
  )
    return;
  const doc = c.documents.find((d) => d.id === documentId);
  if (!doc?.confirmed) return;
  validateCaseDocument(c, doc);
  const { tasks } = snapshotOf(c);
  const task = association.taskId
    ? tasks.find((t) => t.id === association.taskId)
    : undefined;
  if (association.taskId && (!task || !taskAcceptsDocument(task, doc.docType)))
    throw new CaseRuleError(
      "The requested document no longer matches this task.",
    );
  const original = c.documents.find(
    (d) => d.docType === "itemized_bill" && d.confirmed,
  );
  if (doc.docType !== "revised_statement" && original) {
    const eob =
      doc.docType === "eob"
        ? doc
        : c.documents.filter((d) => d.docType === "eob" && d.confirmed).at(-1);
    if (eob)
      assertMatchingEob(
        original.confirmed as ConfirmedBill,
        eob.confirmed as ConfirmedEob,
      );
    await auditCase(caseId, original.id, eob?.id ?? null);
  }
  // Revision verification already fulfills revision tasks. EOBs fulfill only their explicit task.
  if (task && doc.docType === "eob" && task.status !== "done") {
    await store.addEvent(caseId, "tasks_updated", {
      tasks: tasks.map((t) =>
        t.id === task.id
          ? { ...t, status: "done", fulfilledBy: documentId }
          : t,
      ),
    });
  }
  await store.addEvent(caseId, "case_document_checked", { documentId });
}
