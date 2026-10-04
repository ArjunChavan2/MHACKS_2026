# Manually sent letters

The case next step is “I sent this letter,” with a required Date sent field. Patients use Copy email or Open in email app to send their letter themselves. Recording a manual send creates a patient-reported dispute_sent event and marks the current draft sent; it does not contact anyone or record approval to send another message. The case then tracks the response using the reported date, including after reload.

The server rejects missing, invalid, future, duplicate, and stale-draft reports. The action is allowed even when automated contact is on hold, because it only records an action the patient already took. Existing simulated sending remains approval-gated for legacy API consumers, but is not offered in the patient case page or the new next-step messaging prompt.

The patient call controls panel has been removed from the case page. Saved calls and their records remain visible.

Verification covers memory and Postgres date validation, no approval or contact on reporting, preserved sent dates, duplicate and stale targets, persistence, and continued approval gates for automated document requests. Desktop/mobile checks verify the form, request payload, waiting state, reload, and removed call controls.

Case documents now contains an Upload document button that opens the native file picker. The separate Add a document section is removed. Saved files remain listed there; uploaded and pending files expose confirmation and any matching-request selector in the same card. Browser checks exercise the picker, a synthetic revised-statement upload, and confirmation through the existing backend.
