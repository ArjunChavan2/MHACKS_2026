# BillLess frontend update

Patient-facing direction selected with the user: BillLess branding, deep blue and pale sky
colors, Nunito headings and Inter details from Google Fonts, and Billy the goat mascot.
Use one task per screen with Upload → Confirm → Review → Prepare letter progress. Findings
show the existing administrative request first and retain the server explanation and source
links behind an evidence control. Patient confirmation and approval gates remain in place.

The mascot is a generated transparent illustration saved at `public/brand/billy.png`.
Paper's review designs were updated; its new upload artboards are incomplete because the
weekly Paper editing limit was reached.

Integration: stashed local work, fast-forwarded main from `23d71dc` to `0afead3`, and reapplied
the stash. Resolved the sole import conflict by retaining the frontend's formatted imports
and the upstream `RecordsOrigin` type required by the new records-source labels. Preserve
the pulled case-flow, extraction, and provider changes. Keep the original stash as a backup.
Temporary `.tmp` read caches remain local.

The first push was rejected after main advanced to `56a1c54`. Rebased this change onto that
commit, retaining the new case-tracking screen and shared source labels. Show the four-step
guide only during bill review, and preserve the upstream URL behavior while a saved case
loads. Lint, type checking, and all 91 tests pass after resolving these conflicts.
