# Frontend research — October 3, 2026

Scope: public Reddit threads discovered through web search, read as qualitative product research. This is a small, self-selected sample, not a representative survey or verified billing guidance. Recommendations below are design inferences, not changes to the project spec.

## Findings mapped to UI

| Patient problem                                                                      | Reddit source                                                                                           | UI recommendation                                                                                                                                                                |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| “I have the itemized bill; what next?”                                               | https://www.reddit.com/r/personalfinance/comments/175gdne                                               | Case workspace with one primary next action and a short progress timeline.                                                                                                       |
| Cannot tell whether charges are reasonable                                           | https://www.reddit.com/r/personalfinance/comments/hxbkhs                                                | Each finding expands to the original bill lines, rule explanation, and source. Avoid unsupported fair-price estimates.                                                           |
| Confuses EOB with an actual bill                                                     | https://www.reddit.com/r/personalfinance/comments/1fw39dj                                               | Separate Bill, EOB, and Denial upload slots with plain-language explanations; label patient responsibility separately from total charges.                                        |
| Unsure whether to contact hospital or insurer; worries about undocumented agreements | https://www.reddit.com/r/personalfinance/comments/1d82mcj                                               | Name the recipient of every action; retain call history and written-offer status.                                                                                                |
| Requesting an itemized bill does not necessarily reduce the balance                  | https://www.reddit.com/r/personalfinance/comments/1stxy5n/removed/                                      | Distinguish amount under review, proposed reduction, and confirmed savings. Never count flagged dollars as money saved. The original post is removed; use visible comments only. |
| Assistance has a separate document/application workflow                              | https://www.reddit.com/r/MedicalBill/comments/1upiyvh/advice_on_applying_for_charity_care_for_an/       | Optional assistance checklist alongside the audit; use actual hospital policy if eligibility is later implemented.                                                               |
| Users want control over imperfect extraction                                         | https://www.reddit.com/r/SideProject/comments/1v800e0/i_added_receipt_scanning_to_my_grocery_budgeting/ | Editable extraction review next to the document image, with explicit patient confirmation before audit. This source is adjacent receipt UX, not medical-billing evidence.        |

## Recommended aesthetic

Calm patient advocate rather than a trading dashboard. White canvas, deep evergreen #173F35 primary, pale botanical #EFF5F1 secondary surfaces, charcoal #18201D text, muted gray #606B65, amber #8B5B0A for needs-review states. Inter for interface text, a restrained editorial serif for the welcome heading. Tabular numerals for all money. Spacious 8px spacing scale, 16px body text, 44px minimum interaction targets, subtle borders, minimal shadows. Status must include text and an icon rather than color alone.

Desktop: quiet navigation rail; case workspace with findings on the left and source document on the right. Mobile: stacked content, bottom navigation (Cases / Upload / Updates), persistent next-action button. No decorative chart unless it answers a patient question.

## Hackathon screen sequence

1. Start: “Make sense of your medical bill.” Primary Upload a bill; secondary Try demo case. Optional EOB, with definition. Explain what is needed next.
2. Confirm extraction: document preview, editable line items, totals reconciliation, confirmed fields. Audit starts only after all fields are confirmed.
3. Case review: billed responsibility, amount under review, confirmed savings. Timeline: Uploaded → Confirmed → Reviewed → Action → Resolved. Findings show bill-line citations; a missing record is a documentation request.
4. Draft review: cited email or call script, named recipient, explicit approval control. Export/download is visible.
5. Live call: current status, transcript, highlighted offer and 2–4 patient decision buttons. Timeout state asks for writing/callback and commits to nothing. Distinguish offered from accepted terms.
6. Resolution: written confirmation, adjusted balance, confirmed savings, downloadable case history.

Include empty, processing, extraction failure, no findings, missing EOB, unsupported denial, no evidence, offline, and awaiting approval states. Offline may allow returning to the app shell; sensitive document caching requires a deliberate implementation choice. Prevent duplicate submission when reconnecting.

## Demo focus

Prioritize upload/confirmation, evidence-linked case review, and live call decisions. These demonstrate the repo's FinchNode and patient-control differentiators. Defer general budgeting charts, price comparison, eligibility automation, and social features. Use synthetic fixtures only and label demo values.
