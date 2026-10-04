/**
 * @file Case storage: Neon when `DATABASE_URL` is set, otherwise an in-memory store for local runs
 * (SPEC.md §4.6, §5.1).
 *
 * MVP 1 keeps cases, documents (with extraction and confirmation), findings, an append-only event
 * log, and the original files. Files are private: with Neon they live in the `files` table, in
 * memory otherwise. Never expose stored files publicly.
 */
import { neon } from "@neondatabase/serverless";
import { asc, eq } from "drizzle-orm";
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
  /** Draft for outgoing letters; `null` for incoming documents. */
  draft: unknown;
}

/** One timeline event. */
export interface StoredEvent {
  type: string;
  data: unknown;
  /** ISO timestamp. */
  createdAt: string;
}

/** A case with everything stored for it, oldest first. */
export interface StoredCase {
  id: string;
  goal: string | null;
  status: string;
  documents: StoredDocument[];
  findings: Finding[];
  events: StoredEvent[];
}

/** The storage operations MVP 1 needs. */
export interface CaseStore {
  /** Creates a case and returns its ID. */
  createCase(goal: string | null): Promise<string>;
  /** Sets a case's status. */
  setCaseStatus(caseId: string, status: string): Promise<void>;
  /** Reads a case with its documents, findings, and events, or `null`. */
  getCase(caseId: string): Promise<StoredCase | null>;
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
  const caseRows = new Map<string, { goal: string | null; status: string }>();
  const docs = new Map<string, StoredDocument>();
  const found = new Map<string, Finding[]>();
  const events: Array<{ caseId: string } & StoredEvent> = [];
  const stored = new Map<string, StoredFile>();
  return {
    async createCase(goal) {
      const id = newId("case");
      caseRows.set(id, { goal, status: "draft" });
      return id;
    },
    async setCaseStatus(caseId, status) {
      const row = caseRows.get(caseId);
      if (row) row.status = status;
    },
    async getCase(caseId) {
      const row = caseRows.get(caseId);
      if (!row) return null;
      return structuredClone({
        id: caseId,
        ...row,
        documents: [...docs.values()].filter((d) => d.caseId === caseId),
        findings: found.get(caseId) ?? [],
        events: events.filter((e) => e.caseId === caseId).map(({ type, data, createdAt }) => ({ type, data, createdAt })),
      });
    },
    async saveDocument(doc) {
      if (!caseRows.has(doc.caseId)) throw new Error(`Unknown case ${doc.caseId}`);
      const existing = docs.get(doc.id);
      docs.set(doc.id, structuredClone(existing ? { ...existing, status: doc.status, extraction: doc.extraction, extractionMeta: doc.extractionMeta, confirmed: doc.confirmed, draft: doc.draft } : doc));
    },
    async getDocument(id) {
      return docs.get(id) ?? null;
    },
    async saveFindings(caseId, list) {
      found.set(caseId, structuredClone(list));
    },
    async addEvent(caseId, type, data) {
      events.push({ caseId, type, data: structuredClone(data), createdAt: new Date().toISOString() });
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
 * Maps a `documents` row to a `StoredDocument`.
 *
 * @param row - Selected row.
 * @returns The stored document (without `createdAt`).
 */
function toStoredDocument(row: typeof documents.$inferSelect): StoredDocument {
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
    draft: row.draft,
  };
}

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
    async setCaseStatus(caseId, status) {
      await db.update(cases).set({ status }).where(eq(cases.id, caseId));
    },
    async getCase(caseId) {
      const [row] = await db.select().from(cases).where(eq(cases.id, caseId));
      if (!row) return null;
      const [docRows, findingRows, eventRows] = await Promise.all([
        db.select().from(documents).where(eq(documents.caseId, caseId)).orderBy(asc(documents.createdAt)),
        db.select().from(findings).where(eq(findings.caseId, caseId)),
        db.select().from(caseEvents).where(eq(caseEvents.caseId, caseId)).orderBy(asc(caseEvents.createdAt)),
      ]);
      return {
        id: row.id,
        goal: row.goal,
        status: row.status,
        documents: docRows.map(toStoredDocument),
        findings: findingRows.map((f) => f.body as Finding),
        events: eventRows.map((e) => ({ type: e.type, data: e.data, createdAt: e.createdAt.toISOString() })),
      };
    },
    async saveDocument(doc) {
      await db
        .insert(documents)
        .values(doc)
        .onConflictDoUpdate({ target: documents.id, set: { status: doc.status, extraction: doc.extraction, extractionMeta: doc.extractionMeta, confirmed: doc.confirmed, draft: doc.draft } });
    },
    async getDocument(id) {
      const [row] = await db.select().from(documents).where(eq(documents.id, id));
      return row ? toStoredDocument(row) : null;
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
