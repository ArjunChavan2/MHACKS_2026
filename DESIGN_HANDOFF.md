# BillLess — frontend and design handoff

Updated October 4, 2026. Read `SPEC.md` and `AGENTS.md` first: they govern product behavior,
engineering, patient approval, evidence, and the current MVP. This document records the
patient-facing design and local implementation; it does not supersede the specification.

## Current state

The agreed brand is **BillLess**, with **Billy**, a friendly illustrated billy goat. The
patient is overwhelmed by a medical bill and wants a concrete next step. The interface is
warm and reassuring, with plain language, one task per review screen, and a clear primary
action. The voice uses “Let’s” and “we” without inventing health facts or savings claims.

The BillLess review redesign was pushed on `main` as `a7f7fbf`, rebased onto the team's
case-tracking changes. The home page, hover, footer, sample information pages, and shared
spacing are committed locally as `7e8f463`, on top of upstream `d01c4b4`. These new commits
have **not been pushed**. The pull preserved upstream deployment/PDF-rendering fixes,
the domain/deployment notes, and the MVP 3 iMessage plan. `.tmp/` contains unrelated local
read caches; leave it out of commits. Stashes named `BillLess local changes before latest
pull` and `BillLess home footer spacing and design handoff before latest pull` remain as
backups. Check Git status and remote history before integrating further teammate work.

## Screens and navigation

| Route               | Purpose and behavior                                                                                                       |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `/`                 | Landing page: hero, Billy and illustrative receipt, How it works, review CTA, footer                                       |
| `/review`           | Existing document intake → field confirmation → deterministic audit → draft review; includes case tracking when applicable |
| `/?case=<id>`       | Legacy saved-case link: renders the original workspace directly; keep this compatible                                      |
| `/review?case=<id>` | Resumes a saved case through the workspace's existing URL behavior                                                         |
| `/privacy`          | Clearly labeled sample privacy content; no finalized retention or deletion policy                                          |
| `/help`             | Sample help and contact content; `support@example.com` is an unmonitored example                                           |
| `/terms`            | Clearly labeled prototype terms outline, not a published service agreement                                                 |
| `/operator`         | Teammate's simulated billing-office console; separate from public navigation                                               |

Home CTA opens `/review`. The workspace logo returns to `/`. Start over resets the workspace
and removes the case query; it is distinct from returning home. How it works is a real
in-page anchor. Footer links have real destinations. The information-page logo and Back to
home link return to `/`. No contact form, actual inbox, or outbound messaging was added.

## Visual system

| Role                          | Value                                                            |
| ----------------------------- | ---------------------------------------------------------------- |
| Page background               | `#fcfdfe`                                                        |
| Primary actions and blue text | `#214e83`                                                        |
| Pale sky surfaces             | `#eef5fc`                                                        |
| Main text                     | `#203653`                                                        |
| Secondary text                | `#586b82`                                                        |
| Borders                       | `#dce6f0`                                                        |
| Secondary wordmark blue       | `#507baa`                                                        |
| Small coral wordmark dot      | `#eeac82`                                                        |
| Heading family                | Google Fonts **Nunito**, 600–900; prominent headings use 800/900 |
| Body family                   | Google Fonts **Inter**, 400–700; system sans fallback            |

Fonts load through a Google Fonts stylesheet and preconnects in `app/layout.tsx`, with
`display=swap`. The browser fetches them; builds do not need to download fonts. Keep the
fallback stack for offline or blocked font requests. Root-layout ESLint suppression is
scoped to the Pages Router custom-font rule, with an explanatory comment.

Shared page shell lives in `app/globals.css`: `--site-max-width: 1280px`, desktop gutters
64px with 40px top/bottom padding; at ≤1000px gutters and padding become 32px; at ≤700px
both become 24px. `.paper-app`, `.billless-home`, and `.billless-info-page` use the same
variables. `.billless-site-header` aligns their header baseline, 44px brand target, 24px
padding below, and bottom border. Wordmark is 30px desktop and 26px phone.

Information-page body text stays at a 760px maximum width for reading, inside the shared
shell. Review progress, introduction, and intake use a 960px inner maximum. The landing
hero uses the wider shell with a two-column illustration layout, then stacks on phones.
Shared outer alignment does not require identical internal content widths.

Spacing generally follows 8px increments, with 12px/24px grouping, 24–40px section gaps,
and restrained borders. Controls should remain at least 44px tall. Typical text is 15–18px
with 24–29px line height; hero display is up to 62px desktop and 44px phone (40px at ≤360px).
Card radii are generally 20–24px; controls 14px. Primary actions have a small navy offset
shadow. Avoid adding decorative charts, gradients, extra claims, or multiple competing CTAs.

## Assets and motion

`public/brand/billy.png` is the transparent generated mascot asset, roughly 960KB. It is
used by Next Image on the home page and in `BillyGuide`. Preserve its transparency and
proportions. The receipt, speech bubble, and pale circle are native HTML/CSS, not a flattened
hero image. After the copy/design audit, the receipt shows verbatim lines 3 and 5 from
`fixtures/llm-output/sample-bill.json`: code 84443, date 03/05/2026, and $68.00 per line.
It is labeled SYNTHETIC BILL · DEMO ONLY and cites the sample bill page and lines. Those
figures are example charges, not savings. The example is available to assistive technology;
Billy's home image has descriptive alt text. No patient name is displayed.

The current headline is “Know what to question on your medical bill.” CTA wording is
consistently “Review my bill.” How it works uses Upload and confirm / Review the findings /
Prepare your letter. Generic reassurance labels and the extra final CTA card were removed.
“We’ve goat this” is the sole playful aside. The mascot sits beside the sample on desktop
and below it on phones so it does not cover the evidence. These audit edits are local and
uncommitted after the preceding home/design commits.

Billy's generation direction: soft 2D cream goat, navy contour, small tan horns, large
expressive ears, blue-gray hooves, sky-blue neckerchief, raised waving hoof, friendly
three-quarter stance, minimal shading, transparent background, no text or money/medical
symbols. Source asset was generated with the built-in image-generation tool, then copied
into the repo; do not depend on the original agent's generated-image cache.

Hero hover performs one 1100ms whole-mascot bounce/wiggle. Receipt lifts 6px and tilts from
−4° to −2°; speech lifts 4px and straightens. It runs only for a fine pointer with hover
and `prefers-reduced-motion: no-preference`; no sticky animation on touch. Re-entering the
hero retriggers it. Existing workflow guide has greeting and busy states and also respects
reduced motion. Do not imply the static goat asset has individually animated limbs.

## Files to edit

| File                                                                  | Responsibility                                                                  |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `app/page.tsx`                                                        | Landing content, receipt illustration, footer, legacy root saved-case behavior  |
| `app/review/page.tsx`                                                 | Thin wrapper for the existing review workspace                                  |
| `app/_components/BillAuditApp.tsx`                                    | Upload slots, confirmation, findings, letter, case navigation                   |
| `app/_components/BillyGuide.tsx`                                      | Fixed stage copy, Billy image, named four-step progress                         |
| `app/_components/InfoPage.tsx`                                        | Shared sample information-page shell and navigation                             |
| `app/privacy/page.tsx`, `app/help/page.tsx`, `app/terms/page.tsx`     | Sample information content                                                      |
| `app/globals.css`                                                     | Brand variables, shared page spacing, responsive layouts, animation             |
| `app/layout.tsx`                                                      | Metadata, Google Fonts, viewport                                                |
| `app/_components/CaseScreen.tsx`, `OperatorConsole.tsx`, `sources.ts` | Teammate's case-flow UI and shared evidence labels; preserve these integrations |

## Product and interaction constraints

- Visible review steps: Upload → Confirm → Review → Prepare letter. Progress is informational,
  not a navigation shortcut that bypasses field confirmation.
- Separate itemized-bill and optional EOB slots; define EOB in plain language. Existing server
  classification still determines document type. Only a balance statement routes to an
  itemized-bill request. Keep the synthetic demos available in the upload screen's disclosure.
- Findings show the server's administrative request first; Explanation & evidence expands the
  original explanation and citations. Preserve raw source text and provenance.
- Amount under review is not confirmed savings. Unknown proposed/confirmed reduction remains
  an em dash until supported by the server's case state. No invented monetary success claim.
- Prepare my dispute draft leads to patient review. Nothing is sent, submitted, disclosed, or
  agreed to without the required patient approval. Retain existing PDF error handling.
- Fixed mascot copy describes the task, never interprets a health fact. Empty audits do not
  guarantee the whole bill is correct. Original record-origin labels remain in the UI.
- Sample policies and example emails must remain clearly labeled until real content and
  contact channels are approved. Do not replace them with guessed security/retention promises.

## Design tools and prototype status

[Paper prototype](https://app.paper.design/file/01M428RCW5T1N8D1HWKY3RW9RJ/01K4GP58P8JRM8PGBP0586VKYV),
renamed **BillLess — Frontend prototype**. Four review/no-findings artboards were updated for
desktop/mobile. Two upload artboards were partially built before Paper's weekly tool limit
blocked further edits. Paper does not include the subsequent home/info pages or the latest
spacing correction. The repo is the current implementation reference.

The user asked about Figma. Its plugin was suggested but no connection was confirmed, and
no Figma design was created. Plain Paper → Figma paste as editable frames was not verified.
Copy as PNG gives a visual reference, not editable UI components.

## Run, validate, and next steps

Use the repo's Node/npm installation normally. In this session, Node was available only at
`/private/tmp/node-v22.16.0-darwin-arm64/bin`; prepend it to PATH if needed. The local production
preview runs at **http://localhost:3001/** because port 3000 was already occupied. After code
changes, rebuild and restart this production server, or use `npm run dev -- --port 3001` for
live development. Do not assume a production server automatically picks up source changes.

```sh
npm run lint
npm run typecheck
npm test
npm run build -- --webpack
npm run start -- --port 3001
```

Webpack is used because Turbopack previously failed to open a worker port in this environment.
The integrated BillLess commit passed 91 tests, lint, TypeScript, and production build. Home
navigation and saved-case compatibility were checked in Chrome at 1440, 390, and 320px. Hover
and reduced-motion behavior were checked separately. After the spacing fix, identical header
baselines and gutters, footer links, and no horizontal overflow were verified across all five
public pages at 1440, 900, 390, and 320px. Home/mobile and information/desktop screenshots were
inspected. Lint and the production build pass. Repeat these checks when changing spacing.
Temporary browser scripts and screenshots
are under `/private/tmp/billkind-browser-tools` and `/private/tmp/billless-*`; they are session
artifacts, not portable repo dependencies. Live LLM extraction was not rerun for these UI edits.

Next: push the new frontend/documentation commits when requested, replace sample policies
and contacts before public use, finish or migrate the editable prototype when tools permit,
and review the teammate's case/operator screens for further visual consistency. Keep changes
in UI files scoped; API, types, database, and approval logic remain owned by the current MVP.
