# Letter personalization

The letter screen offers Edit letter, Preview, Save changes, Reset to original, and Cancel. Source-free template paragraphs can be edited; document-backed paragraphs and the final disclaimer remain read-only. A separate optional explanation lets the patient add context. Patient wording is labeled separately from verified document evidence. Correct bill or EOB details remains the route for changing extracted facts.

The case letter endpoint saves a new outgoing document and supersedes the previous one. Server-held originals support reset; client-submitted sources and originals are never trusted. A current-text comparison rejects stale saves. Cases with recorded approvals, correspondence, or calls cannot be edited here. A new draft ID requires approval of that final version; approval targeting the old document fails.

Saved wording persists when the case is reopened and is included in the PDF. Editing hides download and tracking controls until saved or canceled. Source panels continue to show original evidence for locked paragraphs; patient wording is explicitly identified as unverified.

Tests cover memory and Postgres persistence, protected facts and disclaimer, stale saves, reset, prior approval targets, and refusal after sending. Desktop and mobile browser checks cover edit, preview, save/reload, PDF content payload, reset, and cancel.
