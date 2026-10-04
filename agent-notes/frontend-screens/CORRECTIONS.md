# Correcting a review before preparing a dispute

Review now offers **Correct bill or EOB details**. It reopens the same case beside the original files. Flagged values remain editable; the expandable document-value list also allows corrections to values that were originally accepted. Confirmation uses the existing validation and normalization rules. After reconfirmation, the audit reruns and the displayed values refresh from storage.

`POST /api/cases/[id]/reopen` requires an existing itemized-bill case with no recorded approvals, call consent, sent dispute, document requests or office response. It marks existing drafts superseded, appends a reopening event, clears current findings and unlocks bill/EOB confirmation. Original files and history remain stored. Case loading and the state machine ignore superseded drafts and audits preceding the latest reopening event. No database migration or shared-type change is required.

Successful bill/EOB corrections are persisted in their checked extraction so later editing does not revert to the model's original misread values. Original document files and source snippets remain available for comparison. Reopening after correspondence is refused rather than rewriting documents used in a sent dispute.

Verification: existing tests plus reopening/regeneration and approval-lock regression checks on both memory and Postgres stores; 162 tests passed after integrating the team’s case-setup and document-arrival changes. Production webpack build and lint checked. Browser verification passed at 1440px and 390px with real local sample/confirmation/audit APIs: same case ID, editable values, audit rerun, persistence after reload and no horizontal overflow or browser runtime errors. Synthetic samples only.
