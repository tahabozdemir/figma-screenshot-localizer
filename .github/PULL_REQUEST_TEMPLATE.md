## What this changes

<!-- One or two sentences. Link the issue if there is one. -->

## Why

<!-- The constraint or the bug behind it. This is the part that ages well. -->

## How it was tested in Figma

<!-- Not the unit tests — those run in CI. What did you actually do on a canvas?
     The interesting failure modes only show up there: locked layers, component
     instances, missing fonts, mixed character styling, RTL, auto-layout. -->

## Checklist

- [ ] `npm run typecheck && npm test && npm run build` passes
- [ ] Added or updated a test (see CONTRIBUTING.md — almost everything here is testable)
- [ ] New files are in the right `tsconfig` project (`plugin` vs `ui`/`providers`; `shared` is in both)
- [ ] No new runtime dependency, or there is a note below explaining why one is needed
- [ ] No new storage key without a migration, and the `lsl.` prefix is unchanged
- [ ] If a message was added, it is in both the union and the parser in `shared/messages.ts`
- [ ] If a provider was added, `manifest.json`'s allow-list was updated to match
