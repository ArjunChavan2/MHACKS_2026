/**
 * @file Verifies the Neon setup end to end (SPEC.md §6 MVP 0 exit: "Neon keys verified"): connects,
 * confirms every table exists, then writes, reads back, and deletes a throwaway synthetic case
 * through the real `CaseStore`.
 *
 * Run with `npm run db:check` after `npm run db:migrate`. Exits non-zero on any failure. Writes no
 * patient data; the test rows use the goal "db-check" and are removed afterwards.
 */
import { neon } from "@neondatabase/serverless";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/neon-http";
import { getTableConfig } from "drizzle-orm/pg-core";
import * as schema from "../db/schema";
import { pgStore } from "../lib/cases/store";
import { loadLocalEnv } from "./env";

/** Every table `db/schema.ts` defines. */
const TABLES = [
  schema.cases,
  schema.documents,
  schema.findings,
  schema.caseEvents,
  schema.approvals,
  schema.deadlines,
  schema.files,
].map((t) => getTableConfig(t).name);

/**
 * Runs the checks.
 *
 * Side effects: inserts and then deletes one case with a document, file, and event.
 */
async function main(): Promise<void> {
  loadLocalEnv();
  const url = process.env.DATABASE_URL;
  if (!url)
    throw new Error(
      "DATABASE_URL is not set. Add it to .env.local (see .env.example).",
    );
  const sql = neon(url);
  const db = drizzle(sql);

  const rows =
    (await sql`select table_name from information_schema.tables where table_schema = 'public'`) as Array<{
      table_name: string;
    }>;
  const present = new Set(rows.map((r) => r.table_name));
  const missing = TABLES.filter((t) => !present.has(t));
  if (missing.length)
    throw new Error(
      `Missing tables: ${missing.join(", ")}. Run npm run db:migrate.`,
    );
  console.log(`Connected; all ${TABLES.length} tables present.`);

  const store = pgStore(db);
  const caseId = await store.createCase("db-check");
  try {
    const key = await store.putFile(
      new Uint8Array([37, 80, 68, 70]),
      "application/pdf",
    );
    await store.saveDocument({
      id: `${caseId}_doc`,
      caseId,
      docType: "itemized_bill",
      direction: "incoming",
      status: "received",
      fileName: "db-check.pdf",
      storageKey: key,
      extraction: { ok: true },
      extractionMeta: null,
      confirmed: null,
    });
    await store.addEvent(caseId, "db_check", { ok: true });
    const doc = await store.getDocument(`${caseId}_doc`);
    const file = await store.getFile(key);
    if (!doc || doc.storageKey !== key || file?.bytes.length !== 4)
      throw new Error("Round trip read back different data.");
    await db.delete(schema.files).where(eq(schema.files.key, key));
    console.log("Write, read back, and file storage work.");
  } finally {
    await db
      .delete(schema.caseEvents)
      .where(eq(schema.caseEvents.caseId, caseId));
    await db
      .delete(schema.documents)
      .where(eq(schema.documents.caseId, caseId));
    await db.delete(schema.cases).where(eq(schema.cases.id, caseId));
  }
  console.log("Neon OK.");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
