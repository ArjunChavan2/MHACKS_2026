# BillLess user flows — current implementation

Based on `BillAuditApp.tsx`, `CaseScreen.tsx`, the case API and SPEC.md. Insurance-denial appeals are future MVP 5 work; the current letter is a billing dispute.

```mermaid
flowchart TD
  Home[Home] --> Review[Review my bill]
  Home --> Info[Help, privacy or terms]
  Info --> Home
  Review --> Upload[Upload bill and optional EOB]
  Review --> Demo[Choose a synthetic sample]
  Upload --> Kind{Document accepted?}
  Demo --> Kind
  Kind -->|Unsupported or failed| Retry[Show error; try another upload]
  Retry --> Upload
  Kind -->|Balance statement| Request[Prepare itemized-bill request]
  Request --> RequestDraft[Review request and paragraph sources]
  RequestDraft --> RequestPDF[Download PDF; send yourself]
  Kind -->|Itemized bill| Confirm[Review extracted bill and EOB values]
  Confirm -->|Correction or confirmation missing| Blocked[Show blocking fields]
  Blocked --> Confirm
  Confirm -->|Confirmed| Audit[Run supported checks]
  Audit --> Findings{Findings recorded?}
  Findings -->|No| None[Read check limits and assistance/payment-plan guidance]
  None --> Original[View original document]
  Findings -->|Yes| Evidence[Review findings and source evidence]
  Evidence --> Prepare[Prepare my dispute draft]
  Prepare --> Letter[Review letter and paragraph sources]
  Letter --> PDF[Download PDF]
  Letter --> Track[Track this case]
  Track --> Approval[Explicit approval to send simulated dispute]
  Approval --> Wait[Wait for recorded office response]
  Wait --> Response{Response / evidence received}
  Response -->|Error confirmed| Offered[Offer recorded; request revised statement with approval]
  Offered --> Revised[Receive and confirm printed revised statement]
  Revised --> Verify[Verify against original bill and findings]
  Verify -->|Outcome documented| Resolved[Verified savings / resolved issues]
  Verify -->|Unresolved issues remain| Track
  Response -->|Documentation disproves concern| Withdrawn[Withdraw supported concern; continue remaining issues]
  Withdrawn --> Track
  Response -->|Incomplete response| Task[Track missing document, responsible party and follow-up date]
  Task -->|Approved request or follow-up| Wait
  Task -->|Patient takes over| Takeover[Patient handles document task]
  Task -->|Document arrives| Response
  Takeover -->|Evidence later recorded| Response
  Saved[Open saved URL with case ID] --> Resume[Load stored documents, audit, latest draft and case state]
  Resume -->|No audit or draft| Review
  Resume -->|Audit only| Audit
  Resume -->|Latest draft before tracking| Letter
  Resume -->|Dispute draft and tracking phase| Track
```

All review screens also offer Start over. Evidence and original documents can be opened where their controls are shown. Failed operations show errors; case polling retains the last loaded state and offers Retry. The latest upstream adds optional iMessage case linking and text approvals (A to approve, B to hold, WHY for evidence, STOP to disable), when its worker and credentials are configured. Web approvals remain available. Office responses currently enter through the separately labeled `/operator` simulator, not real correspondence.

## Access and persistence today

- There is no dashboard, sign-in, profile or case-list screen.
- A new case ID appears in the URL after ingestion. Bookmark `/review?case=CASE_ID` (legacy `/?case=CASE_ID` also works) to return to the saved state.
- Letter review has **Track this case**. The case screen displays its ID at the bottom.
- Cases are stored in Neon when DATABASE_URL is configured; the local fallback is memory and does not survive a server restart.
- The current prototype uses the case ID as its access key. Account ownership and authorization are not implemented.
- Resume is not a complete draft workspace: unsent local corrections and checkbox selections are not restored as an editable preparation session. A tracked case also lacks a visible route back to its existing letter.

## Recommended next design

```mermaid
flowchart LR
  Home[Home: My cases] --> Account[Sign in / create account]
  Account --> Dashboard[My cases dashboard]
  Dashboard --> New[Start a new bill review]
  Dashboard --> Existing[Open saved case]
  Existing --> Overview[Case overview and next action]
  Overview --> Documents[Documents and evidence]
  Overview --> Drafts[Prepare or reopen letter]
  Overview --> History[Approvals and timeline]
  Drafts --> Check[Check recipient, selected issues and sources]
  Check --> Preview[Preview draft and attached evidence]
  Preview --> Download[Download PDF]
  Preview --> Approve[Explicit approval to send]
```

Keep cases as separate records linked to an authenticated account, rather than putting all medical documents into a profile. The profile stores account settings; each case owns its documents, findings, drafts, deadlines, approvals and timeline. Account-aware authorization is required on case, document and action routes. Dashboard cards should show the case label, last update, status and one next-action button; avoid presenting questioned charges as achieved savings.

Letter preparation should first support reopening an existing draft from its case. Then add a clear preparation checklist: recipient, supported findings, requested documents, source evidence, preview and download/approval. Editing must preserve grounded facts and citations. Insurance-denial appeals need the MVP 5 denial criteria/evidence backend before they become an available user path.
