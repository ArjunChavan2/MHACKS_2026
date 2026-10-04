# MVP 1 Paper frontend integration

User authorization: make the existing Paper design the project's frontend.

Use SPEC.md §2, §4.3–4.5, §5, and MVP 1 as constraints. Extract exact JSX/styles from Paper's desktop and mobile review frames. Apply the evergreen palette, responsive summary, findings/evidence layout, next-action panel, and no-findings state to the existing API-connected app. Carry the visual language through intake, confirmation, and letter review.

Preserve all API contracts, deterministic findings, sample labels, correction/confirmation flow, and manual submission. Do not introduce mock actions for calls, assistance automation, or multi-case navigation. Preserve null offered/confirmed amounts as unknown, and label total billed charges correctly rather than presenting them as patient responsibility.

Verify lint, types, existing tests, production build, and browser workflows at desktop/mobile sizes. Record the Paper source, adaptation choices, limitations, and checks in IMPLEMENTATION.md.
