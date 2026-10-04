/**
 * @file Postgres store tests (SPEC.md §4.6, §5.7): applies the committed migrations to an in-process
 * Postgres (PGlite) and runs the real `pgStore` and case service against it, so the schema, SQL,
 * and JSON round trips are checked without a Neon account. The Neon driver itself is checked
 * live by `npm run db:check`.
 */
import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { caseEvents, cases, findings } from "@/db/schema";
import { auditCase, confirmDocument, ingestSample } from "@/lib/cases/service";
import { pgStore, type CaseStore, type PgDb } from "@/lib/cases/store";
import { fixturePdf } from "../helpers";

const g = globalThis as typeof globalThis & { __mhStore?: CaseStore };
let client: PGlite;
let db: PgDb;

beforeAll(async () => {
  client = new PGlite();
  const pglite = drizzle(client);
  await migrate(pglite, { migrationsFolder: "db/migrations" });
  db = pglite;
  g.__mhStore = pgStore(db);
});

afterAll(async () => {
  g.__mhStore = undefined;
  await client.close();
});

describe("pgStore", () => {
  it("stores a file privately and returns identical bytes", async () => {
    const pdf = fixturePdf("sample-bill");
    const key = await g.__mhStore!.putFile(pdf, "application/pdf");
    const file = await g.__mhStore!.getFile(key);
    expect(file?.mimeType).toBe("application/pdf");
    expect(Buffer.from(file!.bytes).equals(Buffer.from(pdf))).toBe(true);
  });

  it("returns null for unknown documents and files", async () => {
    expect(await g.__mhStore!.getDocument("doc_missing")).toBeNull();
    expect(await g.__mhStore!.getFile("file_missing")).toBeNull();
  });

  it("rejects a document for a case that does not exist (foreign key)", async () => {
    await expect(
      g.__mhStore!.saveDocument({
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
      }),
    ).rejects.toThrow();
  });
});

describe("case service on Postgres", () => {
  it("ingests, confirms, and audits the sample bill and EOB, persisting every step", async () => {
    const bill = await ingestSample(null, "sample-bill");
    const eob = await ingestSample(bill.caseId, "sample-eob");
    expect(eob.caseId).toBe(bill.caseId);

    const stored = await g.__mhStore!.getDocument(bill.documentId);
    expect(stored?.extraction).toEqual(
      bill.result.kind === "bill" ? bill.result.bill : undefined,
    );
    expect(await g.__mhStore!.getFile(stored!.storageKey!)).not.toBeNull();

    const input = {
      corrections: {},
      confirmedPaths: [],
      acknowledgeTotalsMismatch: false,
    };
    expect(await confirmDocument(bill.documentId, input)).toEqual({ ok: true });
    expect(await confirmDocument(eob.documentId, input)).toEqual({ ok: true });
    expect((await g.__mhStore!.getDocument(bill.documentId))?.status).toBe(
      "confirmed",
    );
    await expect(confirmDocument(bill.documentId, input)).rejects.toThrow(
      /already confirmed/,
    );

    const first = await auditCase(bill.caseId, bill.documentId, eob.documentId);
    expect(first.findings.length).toBeGreaterThan(0);
    await auditCase(bill.caseId, bill.documentId, eob.documentId);
    const rows = await db
      .select()
      .from(findings)
      .where(eq(findings.caseId, bill.caseId));
    expect(
      rows
        .map((r) => r.body)
        .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
    ).toEqual(
      [...first.findings].sort((a, b) =>
        JSON.stringify(a).localeCompare(JSON.stringify(b)),
      ),
    );

    const events = await db
      .select()
      .from(caseEvents)
      .where(eq(caseEvents.caseId, bill.caseId));
    expect(events.map((e) => e.type).sort()).toEqual([
      "audit_run",
      "audit_run",
      "document_received",
      "document_received",
      "fields_confirmed",
      "fields_confirmed",
    ]);
    expect(
      await db.select().from(cases).where(eq(cases.id, bill.caseId)),
    ).toHaveLength(1);
  });
});
