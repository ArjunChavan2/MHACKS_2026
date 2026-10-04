# BillLess home page

The user requested a separate home page before bill intake. `/` introduces the product with
Billy, Nunito headings, Inter details, the existing blue palette, a three-part explanation,
and links to `/review`. `/review` hosts the existing bill-audit component. Its logo returns
home; Start over still resets the workspace. Existing `/?case=…` links continue to render
the saved-case workspace directly, preserving previously shared URLs.

The receipt contains no real patient data, invented medical finding, or savings
amount. It now displays verbatim synthetic charges from sample-bill lines 3 and 5,
labeled as a demo and cited to page 1. The page describes review and patient-approved drafting without guaranteeing a
reduction or claiming the bill is wrong. No API, database, audit, or approval rules change.

Validation: lint, TypeScript, and the Webpack production build passed. Local Chrome checks
cover the home page, mascot loading, home-to-review and return navigation, root saved-case
links, browser errors, and horizontal overflow at desktop and phone widths. Screenshots
were inspected at 1440px and 390px. A narrow 320px illustration overflow was corrected.
The local preview uses port 3001 because port 3000 was already occupied.

Hero hover: Billy performs one brief bounce and wiggle, while the receipt and speech bubble
lift slightly. CSS enables this only for a fine pointer with hover and no reduced-motion
preference. Touch devices and reduced-motion users retain the static illustration.

Footer: removed the promotional taglines at the user's request. Currently shows the
BillLess copyright and the working How it works anchor. Privacy, help/contact, and terms
links are recommendations for actual pages, not placeholders added to the interface.

At the user's subsequent request, added working `/privacy`, `/help`, and `/terms` routes
with explicitly labeled sample content and footer navigation. Example support/privacy emails
use `example.com` and are identified as unmonitored. The privacy and terms samples avoid
promising finalized retention, deletion, security, or service terms. `InfoPage` shares the
readable page layout and home navigation. No contact form or outbound messaging was added.

Integration on October 4: stashed all tracked/untracked local changes, fast-forwarded main
from `a7f7fbf` to `d01c4b4`, and restored the stash without conflicts. Frontend changes are
committed as `7e8f463`; design handoff documentation is a separate descriptive commit. Keep
both stash backups and exclude `.tmp/` caches. All 91 tests, lint, and Webpack build passed
after the pull. Standalone type checking was rerun after the build to avoid a race with
Next.js regenerating `.next/types`. These commits have not been pushed.

Copy/design audit follow-up: changed the headline to “Know what to question on your medical
bill,” standardized CTA labels, replaced abstract section headings with concrete workflow
labels, and removed the repeated final CTA card. Removed repeated reassurance while keeping
Billy's one “We’ve goat this” aside. The hero now illustrates the actual synthetic duplicate
lines ($68.00 each) with code/date, a possible-duplicate label, and a source caption. It
does not claim an error is confirmed or that those dollars have been saved. Browser layout
and navigation checks cover the new headline, sample rows, labels, and phone widths.
