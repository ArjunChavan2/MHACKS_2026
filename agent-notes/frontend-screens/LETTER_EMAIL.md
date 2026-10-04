# Email handoff

The shared letter preview replaces Download PDF with Copy email and Open in email app. A provider email field (insurer email for appeals) stores the patient-supplied recipient on the current letter. No address is guessed and no message is sent by BillLess.

Copy email puts recipient when present, subject, and every saved paragraph into plain text. It works before an address is known. A read-only manual-copy field appears if clipboard access is denied. Open in email app requires a valid single address and uses encoded mailto recipient, subject, and body. The patient reviews the composed email and chooses Send themselves. If the mail app cannot handle the full letter, Copy email provides a fallback.

Recipient persistence uses PATCH on the case letter endpoint, with email validation and a limit of 254 characters. Approved or acted-on cases cannot change their recipient here. Saved letter edits retain the recipient. Dispute, itemized request, appeal, and doctor documentation request screens share the same email controls. The PDF endpoint remains available to other existing consumers.

Tests cover copy content, URI escaping, recipient persistence through reload and wording changes, clearing, and refusal after approval. Browser checks cover desktop/mobile copying, disabled mailto without an address, invalid email feedback, saved recipient reload, and clipboard denial fallback.
