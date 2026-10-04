/**
 * @file Case store tests (SPEC.md §4.6, §5.7): applies the committed migrations to an in-process
 * Postgres (PGlite) and runs the real `pgStore` and case service against it, and runs the same
 * service flow on the in-memory store so both behave alike. The Neon driver itself is checked
 * live by `npm run db:check`.
 */
import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { caseEvents, cases, documents, findings } from "@/db/schema";
import {
  auditCase,
  confirmDocument,
  draftItemizedRequest,
  draftLetter,
  ingestSample,
  loadCase,
} from "@/lib/cases/service";
import {
  memoryStore,
  pgStore,
  type CaseStore,
  type PgDb,
} from "@/lib/cases/store";
import { fixturePdf } from "../helpers";

const g = globalThis as typeof globalThis & { __mhStore?: CaseStore };
let client: PGlite;
let db: PgDb;
let pg: CaseStore;

/** Confirmation input with no corrections. */
const AS_PRINTED = {
  corrections: {},
  confirmedPaths: [],
  acknowledgeTotalsMismatch: false,
};

beforeAll(async () => {
  delete process.env.GEMINI_API_KEY;
  client = new PGlite();
  const pglite = drizzle(client);
  await migrate(pglite, { migrationsFolder: "db/migrations" });
  db = pglite;
  pg = pgStore(db);
});

afterAll(async () => {
  g.__mhStore = undefined;
  await client.close();
});

describe("pgStore", () => {
  it("stores a file privately and returns identical bytes", async () => {
    const pdf = fixturePdf("sample-bill");
    const key = await pg.putFile(pdf, "application/pdf");
    const file = await pg.getFile(key);
    expect(file?.mimeType).toBe("application/pdf");
    expect(Buffer.from(file!.bytes).equals(Buffer.from(pdf))).toBe(true);
  });

  /** Proves the latest event of a type is found across cases, ignoring other event types. */
  it("finds the latest event of a type", async () => {
    expect(await pg.latestEventOf("call_armed_none")).toBeNull();
    const a = await pg.createCase(null);
    const b = await pg.createCase(null);
    await pg.addEvent(a, "call_armed", {});
    await new Promise((r) => setTimeout(r, 5));
    await pg.addEvent(b, "audit_run", {});
    const hit = await pg.latestEventOf("call_armed");
    expect(hit?.caseId).toBe(a);
    expect(Number.isNaN(Date.parse(hit!.createdAt))).toBe(false);
  });

  it("returns null for unknown cases, documents, and files", async () => {
    expect(await pg.getCase("case_missing")).toBeNull();
    expect(await pg.getDocument("doc_missing")).toBeNull();
    expect(await pg.getFile("file_missing")).toBeNull();
  });

  it("rejects a document for a case that does not exist (foreign key)", async () => {
    await expect(
      pg.saveDocument({
        id: "doc_orphan",
        caseId: "case_missing",
        docType: "eob",
        direction: "incoming",
        status: "received",
        fileName: null,
        storageKey: null,
        extraction: null,
        extractionMeta: null,
        confirmed: null,
        draft: null,
      }),
    ).rejects.toThrow();
  });
});

describe.each([
  ["Postgres", () => pg],
  ["memory", () => memoryStore()],
])("case service on the %s store", (_name, makeStore) => {
  beforeAll(() => {
    g.__mhStore = makeStore();
  });

  it("ingests, confirms, audits, and drafts, then reloads the case exactly", async () => {
    const bill = await ingestSample(null, "sample-bill");
    const eob = await ingestSample(bill.caseId, "sample-eob");
    expect(eob.caseId).toBe(bill.caseId);

    const stored = await g.__mhStore!.getDocument(bill.documentId);
    expect(stored?.extraction).toEqual(
      bill.result.kind === "bill" ? bill.result.bill : undefined,
    );
    expect(await g.__mhStore!.getFile(stored!.storageKey!)).not.toBeNull();

    expect(await confirmDocument(bill.documentId, AS_PRINTED)).toEqual({
      ok: true,
    });
    expect(await confirmDocument(eob.documentId, AS_PRINTED)).toEqual({
      ok: true,
    });
    await expect(confirmDocument(bill.documentId, AS_PRINTED)).rejects.toThrow(
      /already confirmed/,
    );

    const first = await auditCase(bill.caseId, bill.documentId, eob.documentId);
    expect(first.findings.length).toBeGreaterThan(0);
    const audit = await auditCase(bill.caseId, bill.documentId, eob.documentId);
    expect((await g.__mhStore!.getCase(bill.caseId))?.status).toBe("audited");

    const draft = await draftLetter(
      bill.caseId,
      bill.documentId,
      eob.documentId,
    );
    const view = await loadCase(bill.caseId);
    expect(view).toEqual({
      caseId: bill.caseId,
      status: "letter_drafted",
      documents: [
        { ingest: bill, confirmed: true, fileName: "sample-bill.pdf (sample)" },
        { ingest: eob, confirmed: true, fileName: "sample-eob.pdf (sample)" },
      ],
      audit,
      draft,
      appeal: null,
      state: expect.objectContaining({
        phase: "awaiting_approval",
        next: expect.objectContaining({ actionId: "send_dispute" }),
      }),
    });

    const c = await g.__mhStore!.getCase(bill.caseId);
    const outgoing = c!.documents.filter((d) => d.direction === "outgoing");
    expect(outgoing).toHaveLength(1);
    expect(outgoing[0]).toMatchObject({
      docType: "dispute_letter",
      status: "drafted",
      draft,
    });
    expect(c!.findings).toHaveLength(audit.findings.length);
    expect(c!.events.map((e) => e.type)).toEqual([
      "document_received",
      "document_received",
      "fields_confirmed",
      "fields_confirmed",
      "audit_run",
      "audit_run",
      "letter_drafted",
    ]);
  });

  it("saves an itemized-bill request as an outgoing document", async () => {
    const stmt = await ingestSample(null, "balance-statement");
    const draft = await draftItemizedRequest(stmt.documentId);
    const view = await loadCase(stmt.caseId);
    expect(view?.status).toBe("request_drafted");
    expect(view?.draft).toEqual(draft);
    expect(view?.audit).toBeNull();
  });

  it("returns null for an unknown case and refuses documents for it", async () => {
    expect(await loadCase("case_missing")).toBeNull();
    await expect(ingestSample("case_missing", "sample-bill")).rejects.toThrow(
      /Unknown case/,
    );
  });
});

describe("Postgres rows", () => {
  it("writes the case, documents, findings, and events to their tables", async () => {
    g.__mhStore = pg;
    const bill = await ingestSample(null, "sample-bill");
    await confirmDocument(bill.documentId, AS_PRINTED);
    const audit = await auditCase(bill.caseId, bill.documentId, null);
    const [row] = await db
      .select()
      .from(cases)
      .where(eq(cases.id, bill.caseId));
    expect(row.status).toBe("audited");
    expect(
      await db
        .select()
        .from(documents)
        .where(eq(documents.caseId, bill.caseId)),
    ).toHaveLength(1);
    const rows = await db
      .select()
      .from(findings)
      .where(eq(findings.caseId, bill.caseId));
    expect(rows.map((r) => r.body)).toEqual(
      expect.arrayContaining(audit.findings),
    );
    expect(rows).toHaveLength(audit.findings.length);
    expect(
      await db
        .select()
        .from(caseEvents)
        .where(eq(caseEvents.caseId, bill.caseId)),
    ).toHaveLength(3);
  });
});
