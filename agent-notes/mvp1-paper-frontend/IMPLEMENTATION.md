# MVP 1 Paper frontend integration

## What changed

The default app now uses the approved Paper frontend: Billkind branding, white/evergreen palette, responsive financial summary, desktop findings/action columns, stacked mobile layout, evidence panels, and the no-findings state. Intake, confirmation, balance-statement requests, and letter review retain the existing API-backed MVP 1 behavior. Updated the page metadata and README.

Source: https://app.paper.design/file/01M428RCW5T1N8D1HWKY3RW9RJ/01K4GP58P8JRM8PGBP0586VKYV

Read Paper JSX and computed styles directly for the desktop/mobile frames. Exact core values: primary #173F35, surface #EFF5F1, ink #18201D, muted #606B65, border #DDE6E0; desktop 40px/64px outer padding, 32px section spacing, 40px workspace gap, 36px/44px headings; mobile 24px padding and 28px/34px headings; 12px finding radius and 10px action radius. Paper's actual exported font is system-ui, so no remote font dependency was added.

## Adaptation decisions

- All amounts, findings, explanations, requests, and sources come from existing APIs, never hardcoded mockup data.
- The existing verdict returns total charges, so label it “Total billed charges,” not patient responsibility. Null offered/confirmed values remain unknown (an em dash), not fabricated zero savings.
- Preserve the offered-reduction field required by SPEC.md.
- No decorative navigation, call-script action, or automated assistance button for features outside MVP 1. The no-findings state offers honest assistance/payment-plan guidance and original-document inspection.
- Source evidence is keyboard-accessible and links back to bill pages; draft paragraphs are buttons so keyboard users can inspect citations.
- Retain the original extracted line-item view, explicitly labeled as original extraction because corrected values are used by the backend audit.
- PDF failures now display an alert rather than downloading an HTTP error as a PDF. Nothing is sent or submitted.
- Sensitive document caching, installability, and live calls are outside this frontend integration.

## Validation

- Existing Vitest suite: 42 tests passed across 6 files.
- ESLint and TypeScript checks passed.
- Production build passed with `npm run build -- --webpack`. Default Turbopack failed on an environment worker-port restriction, including after an escalation retry; no build configuration was changed to conceal it.
- Headless Chrome browser smoke checks at 1440px and 390px: real synthetic sample APIs through intake, confirmation, findings, evidence expansion, draft generation, source inspection, and successful PDF download. Intercepted PDF failure produced the expected visible alert.
- No-findings UI tested at both widths by replacing a real audit response's findings with an empty list and questioned amount with zero. This is a presentation test, not proof of a no-findings audit rule outcome.
- No browser runtime errors or horizontal page overflow in either layout. Screenshots visually reviewed.
- Original file-upload API and real Gemini/Neon integrations were not exercised; no credentials required for fixture checks.

Temporary Node runtime and Playwright tooling were installed under /private/tmp, not added as project dependencies. Local preview runs at http://localhost:3000.
