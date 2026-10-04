/**
 * @file Neon Postgres schema (Drizzle) (SPEC.md §4.6 data relationships, §6 MVP 0).
 *
 * MVP 1 writes `cases`, `documents`, `findings`, `case_events`, and `files`. `approvals` and
 * `deadlines` exist for MVP 2 (created now per the MVP 0 schema list); `calls` arrives with MVP 4.
 * JSON columns hold typed objects from `lib/types`; the application validates them before writing.
 *
 * After changing this file run `npm run db:generate` and commit the new SQL in `db/migrations/`;
 * `npm run db:migrate` applies it to the database in `DATABASE_URL`.
 */
import { date, integer, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

/** One persistent case per bill (SPEC.md §3.1). */
export const cases = pgTable("cases", {
  id: text("id").primaryKey(),
  /** Patient's goal in their own words (e.g. "Resolve this bill"). */
  goal: text("goal"),
  /** Case status: "draft", then "audited", then "letter_drafted" or "request_drafted". */
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
  /** Draft (lib/types) for outgoing letters: the exact text and sources shown to the patient. */
  draft: jsonb("draft"),
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

/** Patient approvals; required before any call, send, submission, disclosure, or commitment (SPEC.md §4.7). */
export const approvals = pgTable("approvals", {
  id: text("id").primaryKey(),
  caseId: text("case_id").notNull().references(() => cases.id),
  /** What was approved, e.g. "send_dispute_letter". */
  action: text("action").notNull(),
  /** Who approved it (patient or demo user). */
  approvedBy: text("approved_by").notNull(),
  /** What exactly was shown and approved (draft ID, constraints). */
  details: jsonb("details"),
  approvedAt: timestamp("approved_at", { withTimezone: true }).defaultNow().notNull(),
});

/** Deadlines linked to a document (SPEC.md §4.6). */
export const deadlines = pgTable("deadlines", {
  id: text("id").primaryKey(),
  caseId: text("case_id").notNull().references(() => cases.id),
  documentId: text("document_id").references(() => documents.id),
  /** What is due, e.g. "appeal_filing". */
  kind: text("kind").notNull(),
  dueDate: date("due_date").notNull(),
  followUpDate: date("follow_up_date"),
  /** Reminder state, e.g. "pending", "sent", "done". */
  reminderState: text("reminder_state").notNull(),
});

/**
 * Original uploaded and generated files, private (SPEC.md §4.6 "Uploaded files"). Bytes are base64
 * text so every driver handles them the same way. Uploads are capped at 15 MB.
 * *Open:* move to object storage (Vercel Blob or similar, SPEC.md §12) if size becomes a problem.
 */
export const files = pgTable("files", {
  key: text("key").primaryKey(),
  mimeType: text("mime_type").notNull(),
  dataBase64: text("data_base64").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});
