# Contributing

Thanks for taking a look. This is a small, dependency-free codebase and the goal is to keep it that
way — the notes below are mostly about the two or three things that are genuinely easy to get wrong.

## Setup

```bash
nvm use            # Node 22+ (see .nvmrc)
npm install
npm run build
npm test
```

Then in the Figma **desktop app**: _Plugins → Development → Import plugin from manifest…_ and pick
`manifest.json`. `npm run watch` rebuilds on save, but Figma still needs the plugin re-run to pick up
a new build.

| Command             | What it does                                             |
| ------------------- | -------------------------------------------------------- |
| `npm run build`     | Type-checks both projects, then builds `dist/`           |
| `npm run watch`     | Rebuilds on save                                         |
| `npm run typecheck` | Type-check only                                          |
| `npm test`          | Unit tests — no network, no Figma, no extra dependencies |
| `npm run clean`     | Delete `dist/` and `dist-test/`                          |

## The one structural thing to know

There are **two JavaScript environments**, and they have incompatible globals:

- `src/plugin/**` runs in the Figma sandbox. It can touch the document. It has no DOM and no usable
  `fetch`.
- `src/ui/**` and `src/providers/**` run in a browser iframe. They can make network requests. They
  must never touch the document.
- `src/shared/**` is compiled into **both**, so it may not reference `figma.*` or `document.*`.

That is why there are two `tsconfig`s. If you add a file, put it in the right project's `include` or
it will not be type-checked at all.

The two threads talk only through the message protocol in `src/shared/messages.ts`, and every inbound
message is validated on arrival. If you add a message, add it to the union _and_ to the parser.

## Please do

- **Add a test.** `npm test` runs the real modules against fakes — a fake document port, a scripted
  transport, an in-memory storage port. There is almost nothing that "can't be tested here"; if it
  feels that way, the dependency probably wants to be a parameter.
- **Keep the dependency count at zero.** The plugin ships no runtime dependencies, which is a large
  part of why it can credibly claim to be local-only. A PR that adds one needs a good reason.
- **Explain _why_ in comments**, not _what_. The existing comments are mostly about decisions that
  look wrong until you know the constraint. Match that.
- **Raise warnings as codes**, not sentences. Add the code to `src/shared/warnings.ts` and let the UI
  format it — that keeps the wording testable and translatable.

## Please don't

- **Don't change the `lsl.` storage prefix or bump a storage key without a migration.** Those keys
  hold people's API keys, hand-typed translations and translation memory. `src/plugin/storage.ts` has
  a migration and a test for it; follow that pattern, and only delete an old key once the new writes
  are confirmed.
- **Don't build HTML from strings in the UI.** `src/ui/dom.ts` has no way to pass markup through it
  on purpose. Use `el()` and `textContent`.
- **Don't widen `manifest.json`'s `allowedDomains` without a provider that needs it.** A test compares
  the allow-list against the domains the registry declares, so the two cannot drift.

## Adding a translation provider

This is the most common change and it is designed to be small — one new file plus one descriptor.
See [Adding a translation provider](docs/providers.md#adding-a-translation-provider) in the README.

## Pull requests

- Branch from `main`, keep the change focused.
- `npm run typecheck && npm test && npm run build` must pass. CI runs the same on Node 22 and 24.
- Describe what you tested **in Figma**, not just what the tests cover. Most of the interesting
  failure modes here (locked layers, instance overrides, missing fonts, RTL) only show up on a real
  canvas.
- Commit messages: a short imperative subject line. No strict convention beyond that.

## Reporting a bug

Turn on **Debug logging** at the bottom of the panel first, reproduce, and paste what the developer
console prints. It logs exactly the failures the plugin deliberately ignores, which is usually the
missing half of a bug report. See [SECURITY.md](SECURITY.md) if the issue involves API keys.
