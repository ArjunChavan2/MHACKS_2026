/**
 * @file Neon Postgres schema (Drizzle) for MVP 1 (SPEC.md §4.6 data relationships).
 *
 * MVP 1 uses `cases`, `documents`, `findings`, and `case_events`. `approvals`, `deadlines`, and
 * `calls` arrive with MVP 2 and MVP 4. JSON columns hold typed objects from `lib/types`; the
 * application validates them before writing.
 */
import { integer, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

/** One persistent case per bill (SPEC.md §3.1). */
export const cases = pgTable("cases", {
  id: text("id").primaryKey(),
  /** Patient's goal in their own words (e.g. "Resolve this bill"). */
  goal: text("goal"),
  /** Case status, e.g. "draft", "audited". */
  status: text("status").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

/** Every document in or out, with extraction, confirmation, and traceability data (SPEC.md §4.2, §4.6). */
export const documents = pgTable("documents", {
  id: text("id").primaryKey(),
  caseId: text("case_id").notNull().references(() => cases.id),
  /** DocType from lib/types. */
  docType: text("doc_type").notNull(),
  /** "incoming" (uploaded) or "outgoing" (letters we drafted). */
  direction: text("direction").notNull(),
  /** Status, e.g. "received", "confirmed", "drafted". */
  status: text("status").notNull(),
  /** Original file name. */
  fileName: text("file_name"),
  /** Private storage key for the original file (never a public link). */
  storageKey: text("storage_key"),
  /** ExtractedBill or ExtractedEob as shown on the confirm screen. */
  extraction: jsonb("extraction"),
  /** ExtractionMeta: model, prompt and schema versions, raw replies. */
  extractionMeta: jsonb("extraction_meta"),
  /** ConfirmedBill or ConfirmedEob once the patient confirms (locked). */
  confirmed: jsonb("confirmed"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

/** Rule-produced findings (SPEC.md §4.3). */
export const findings = pgTable("findings", {
  id: text("id").primaryKey(),
  caseId: text("case_id").notNull().references(() => cases.id),
  rule: text("rule").notNull(),
  status: text("status").notNull(),
  amountQuestionedCents: integer("amount_questioned_cents").notNull(),
  /** Full Finding object including sources. */
  body: jsonb("body").notNull(),
});

/** Append-only case timeline (SPEC.md §4.6). */
export const caseEvents = pgTable("case_events", {
  id: text("id").primaryKey(),
  caseId: text("case_id").notNull().references(() => cases.id),
  /** Event type, e.g. "document_uploaded", "fields_corrected", "audit_run", "letter_drafted". */
  type: text("type").notNull(),
  /** Event details. */
  data: jsonb("data"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});
