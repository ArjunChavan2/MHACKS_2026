/**
 * @file Case storage: Neon when `DATABASE_URL` is set, otherwise an in-memory store for local runs
 * (SPEC.md §4.6, §5.1).
 *
 * MVP 1 keeps cases, documents (with extraction and confirmation), findings, and an append-only
 * event log. Original files are kept privately in memory (by storage key) for the session; durable
 * private object storage is an open decision (SPEC.md §12). Never expose stored files publicly.
 */
import { neon } from "@neondatabase/serverless";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/neon-http";
import { caseEvents, cases, documents, findings } from "@/db/schema";
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

/** Process-wide singletons kept on `globalThis` so Next.js hot reloads don't drop them in dev. */
const g = globalThis as typeof globalThis & {
  __mhFiles?: Map<string, { bytes: Uint8Array; mimeType: string }>;
  __mhStore?: CaseStore;
};

/** Private, process-local file storage (by storage key). Never served publicly. */
const files = (g.__mhFiles ??= new Map());

/**
 * Stores an uploaded file privately and returns its storage key.
 *
 * Side effects: keeps the bytes in process memory.
 *
 * @param bytes - File bytes.
 * @param mimeType - MIME type.
 * @returns Storage key.
 */
export function putFile(bytes: Uint8Array, mimeType: string): string {
  const key = newId("file");
  files.set(key, { bytes, mimeType });
  return key;
}

/**
 * Reads a privately stored file.
 *
 * @param key - Storage key.
 * @returns The file, or `undefined` if unknown.
 */
export function getFile(key: string): { bytes: Uint8Array; mimeType: string } | undefined {
  return files.get(key);
}

/**
 * In-memory store for local development and demos without a database.
 *
 * @returns A `CaseStore` whose data lives until the server restarts.
 */
export function memoryStore(): CaseStore {
  const docs = new Map<string, StoredDocument>();
  const found = new Map<string, Finding[]>();
  const events: Array<{ caseId: string; type: string; data: unknown; at: string }> = [];
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
  };
}

/**
 * Neon-backed store.
 *
 * @param url - Neon connection string.
 * @returns A `CaseStore` writing to Postgres. Run `npx drizzle-kit push` once to create tables.
 */
export function neonStore(url: string): CaseStore {
  const db = drizzle(neon(url));
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
      return (rows[0] as StoredDocument | undefined) ?? null;
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
  };
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
