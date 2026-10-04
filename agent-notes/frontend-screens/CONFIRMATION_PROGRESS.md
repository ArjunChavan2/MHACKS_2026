# Confirmation progress and missing-field guidance

Each bill/EOB confirmation card now shows an accessible native progress bar, reviewed-item count and next unfinished field. A shortcut opens the relevant field section, selects its document page and focuses the input; it respects reduced motion. An expandable unfinished-field list provides direct navigation. Field labels distinguish value needed, check value and reviewed states, with text hints and accessible invalid markers.

Progress tracks review actions, not a clinical finding or a server confirmation. Missing/unparseable required bill charges cannot be waived with the printed-value checkbox. Whole-document totals acknowledgement is counted separately. Server validation and approval gates remain authoritative. Confirmed fields are disabled; local edits clear obsolete failure messages before the next server check.

Validation: production webpack build and lint passed; full suite 165 tests passed, followed by the three focused progress tests after the final adjustment. Synthetic browser checks passed at 1440px and 390px for missing amounts, progress changes, opening/focusing hidden fields, totals acknowledgement, no horizontal overflow and no browser runtime errors. The phone screenshot was visually inspected.
