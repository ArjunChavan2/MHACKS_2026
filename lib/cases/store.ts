/**
 * @file Case storage: Neon when `DATABASE_URL` is set, otherwise an in-memory store for local runs
 * (SPEC.md §4.6, §5.1).
 *
 * MVP 1 keeps cases, documents (with extraction and confirmation), findings, an append-only event
 * log, and the original files. Files are private: with Neon they live in the `files` table, in
 * memory otherwise. Never expose stored files publicly.
 */
import { neon } from "@neondatabase/serverless";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/neon-http";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { caseEvents, cases, documents, files, findings } from "@/db/schema";
import type { Finding } from "@/lib/types";

/** A stored document row. */
export interface StoredDocument {
  id: string;
  caseId: string;
  docType: string;
  direction: "incoming" | "outgoing";
  status: string;
  fileName: string | null;
  storageKey: string | null;
  extraction: unknown;
  extractionMeta: unknown;
  confirmed: unknown;
}

/** The storage operations MVP 1 needs. */
export interface CaseStore {
  /** Creates a case and returns its ID. */
  createCase(goal: string | null): Promise<string>;
  /** Inserts or replaces a document row. */
  saveDocument(doc: StoredDocument): Promise<void>;
  /** Reads a document, or `null`. */
  getDocument(id: string): Promise<StoredDocument | null>;
  /** Replaces the case's findings with a new audit result. */
  saveFindings(caseId: string, list: Finding[]): Promise<void>;
  /** Appends an event to the case timeline. */
  addEvent(caseId: string, type: string, data: unknown): Promise<void>;
  /** Stores a file privately and returns its storage key. */
  putFile(bytes: Uint8Array, mimeType: string): Promise<string>;
  /** Reads a privately stored file, or `null` if the key is unknown. */
  getFile(key: string): Promise<StoredFile | null>;
}

/** A privately stored file. */
export interface StoredFile {
  bytes: Uint8Array;
  mimeType: string;
}

/**
 * Makes a random ID with a readable prefix.
 *
 * @param prefix - e.g. "case", "doc".
 * @returns A unique ID such as "doc_3f9a…".
 */
export function newId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
}

/** Process-wide store kept on `globalThis` so Next.js hot reloads don't drop it in dev. */
const g = globalThis as typeof globalThis & { __mhStore?: CaseStore };

/**
 * In-memory store for local development and demos without a database.
 *
 * @returns A `CaseStore` whose data lives until the server restarts.
 */
export function memoryStore(): CaseStore {
  const docs = new Map<string, StoredDocument>();
  const found = new Map<string, Finding[]>();
  const events: Array<{ caseId: string; type: string; data: unknown; at: string }> = [];
  const stored = new Map<string, StoredFile>();
  return {
    async createCase() {
      return newId("case");
    },
    async saveDocument(doc) {
      docs.set(doc.id, structuredClone(doc));
    },
    async getDocument(id) {
      return docs.get(id) ?? null;
    },
    async saveFindings(caseId, list) {
      found.set(caseId, structuredClone(list));
    },
    async addEvent(caseId, type, data) {
      events.push({ caseId, type, data, at: new Date().toISOString() });
    },
    async putFile(bytes, mimeType) {
      const key = newId("file");
      stored.set(key, { bytes: bytes.slice(), mimeType });
      return key;
    },
    async getFile(key) {
      return stored.get(key) ?? null;
    },
  };
}

/** Any Drizzle Postgres database: Neon HTTP in the app, PGlite in tests. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type PgDb = PgDatabase<PgQueryResultHKT, any>;

/**
 * Postgres-backed store over any Drizzle Postgres database.
 *
 * Side effects: reads and writes the `cases`, `documents`, `findings`, `case_events`, and `files`
 * tables. Replacing findings is a delete then an insert, not atomic (the Neon HTTP driver has no
 * transactions); re-running the audit repairs a partial write.
 *
 * @param db - Drizzle database with the schema migrated (`npm run db:migrate`).
 * @returns A `CaseStore` writing to Postgres.
 */
export function pgStore(db: PgDb): CaseStore {
  return {
    async createCase(goal) {
      const id = newId("case");
      await db.insert(cases).values({ id, goal, status: "draft" });
      return id;
    },
    async saveDocument(doc) {
      await db
        .insert(documents)
        .values(doc)
        .onConflictDoUpdate({ target: documents.id, set: { status: doc.status, extraction: doc.extraction, extractionMeta: doc.extractionMeta, confirmed: doc.confirmed } });
    },
    async getDocument(id) {
      const rows = await db.select().from(documents).where(eq(documents.id, id));
      const row = rows[0];
      if (!row) return null;
      return {
        id: row.id,
        caseId: row.caseId,
        docType: row.docType,
        direction: row.direction as StoredDocument["direction"],
        status: row.status,
        fileName: row.fileName,
        storageKey: row.storageKey,
        extraction: row.extraction,
        extractionMeta: row.extractionMeta,
        confirmed: row.confirmed,
      };
    },
    async saveFindings(caseId, list) {
      await db.delete(findings).where(eq(findings.caseId, caseId));
      if (list.length) {
        await db.insert(findings).values(
          list.map((f) => ({ id: `${caseId}:${f.id}`, caseId, rule: f.rule, status: f.status, amountQuestionedCents: f.amountQuestionedCents, body: f })),
        );
      }
    },
    async addEvent(caseId, type, data) {
      await db.insert(caseEvents).values({ id: newId("evt"), caseId, type, data });
    },
    async putFile(bytes, mimeType) {
      const key = newId("file");
      await db.insert(files).values({ key, mimeType, dataBase64: Buffer.from(bytes).toString("base64") });
      return key;
    },
    async getFile(key) {
      const rows = await db.select().from(files).where(eq(files.key, key));
      const row = rows[0];
      return row ? { bytes: new Uint8Array(Buffer.from(row.dataBase64, "base64")), mimeType: row.mimeType } : null;
    },
  };
}

/**
 * Neon-backed store over the serverless HTTP driver (works in Vercel functions).
 *
 * @param url - Neon connection string (the pooled one is fine).
 * @returns A `CaseStore` writing to Neon. Run `npm run db:migrate` once to create the tables.
 */
export function neonStore(url: string): CaseStore {
  return pgStore(drizzle(neon(url)));
}

/**
 * Returns the configured store (Neon if `DATABASE_URL` is set, otherwise memory).
 *
 * @returns The shared `CaseStore`.
 */
export function getStore(): CaseStore {
  g.__mhStore ??= process.env.DATABASE_URL ? neonStore(process.env.DATABASE_URL) : memoryStore();
  return g.__mhStore;
}
