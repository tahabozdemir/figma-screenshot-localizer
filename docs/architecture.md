# Architecture

How the code is arranged, why it is arranged that way, and how the layout
engine actually decides what to do.

← [README](../README.md) · [Providers](providers.md) · [Privacy](privacy.md)

---

Four layers, and the dependency arrows only ever point one way: `plugin/` → `shared/`,
`ui/` → `providers/` → `shared/`. The two threads never import each other; they only exchange
messages defined in `shared/messages.ts`.

```
figma-screenshot-localizer/
├── manifest.json          Figma plugin manifest (UI plugin, 6 allowed domains)
├── tsconfig.base.json     Settings both projects share
├── tsconfig.json          Plugin-sandbox project (no DOM lib)
├── tsconfig.ui.json       UI-iframe project (DOM, no Figma typings)
├── build.mjs              esbuild → dist/code.js and a self-contained dist/ui.html
├── src/
│   ├── shared/            Imported by BOTH threads. No figma.*, no document.*
│   │   ├── types.ts         Domain types
│   │   ├── messages.ts      The message protocol + a validator for each direction
│   │   ├── warnings.ts      Warning codes and the one place they become sentences
│   │   ├── defaults.ts      Every default, and the normalizers that fill a partial object
│   │   ├── languages.ts     The 31 languages (per-engine + per-store codes) + frame naming
│   │   ├── rpc.ts           Request/reply over postMessage — used by both threads
│   │   ├── cancellation.ts  CancellationToken
│   │   ├── log.ts           Debug breadcrumbs for deliberately-swallowed errors
│   │   ├── html.ts          The one markup escaper (providers only)
│   │   └── util.ts          Hashing, delay, error text
│   ├── providers/         Translation engines. Network-capable, so UI thread only
│   │   ├── registry.ts      ← single source of truth about providers
│   │   ├── transport.ts     The Transport seam (injected, so providers are testable)
│   │   ├── base.ts          Batching, concurrency pool, retry policy, status mapping
│   │   ├── prompt.ts        System/user prompts, glossary parsing, output parsing
│   │   ├── protect.ts       Placeholder protection + output verification
│   │   └── manual|openai|gemini|google|google-free|deepl.ts
│   ├── plugin/            Sandbox thread. Owns the document
│   │   ├── main.ts          Entry: wires the ports, routes messages. Nothing else
│   │   ├── figma-port.ts    DocumentPort / StoragePort — the seam that makes the rest testable
│   │   ├── pipeline.ts      generate(): resolve → clone → localize → fit, per language
│   │   ├── localize.ts      One frame: writing text, RTL, budgets, the shorten pass
│   │   ├── text-engine.ts   Discovery, fonts, style-preserving replacement, measure + auto-fit
│   │   ├── selection.ts     Selection scan (one traversal, one dedup)
│   │   ├── layout.ts        Bounds, the output grid, containers, finding an earlier run
│   │   ├── storage.ts       clientStorage: settings / secrets / manual / TM, with migration
│   │   └── net-proxy.ts     The sandbox side of the CORS escape hatch
│   └── ui/                Iframe thread. Never touches the document
│       ├── bootstrap.ts     Entry: init() — the only import-time side effect
│       ├── state.ts         Panel state + persistence
│       ├── generate.ts      Validation, starting a run, answering translate requests
│       ├── transport.ts     Browser fetch with the sandbox fallback
│       ├── dom.ts           Element builder — there is no way to pass markup through it
│       ├── views/           selection · languages · mode · manual · options · shell
│       ├── ui.html          Markup template (no provider panels — those are generated)
│       └── styles.css       Figma-theme-aware styles
├── test/                  node --test, no extra dependencies
└── dist/                  Build output — this is what manifest.json points at
```

**Why two TypeScript projects.** The Figma sandbox and the UI iframe have incompatible globals:
`@figma/plugin-typings` declares its own `fetch`, which clashes with the DOM one. Splitting them
means each thread is type-checked against the environment it actually runs in — and it is why
network calls live in the UI thread. `src/shared/` is compiled by both, so it may not reference
either environment.

**Why the ports.** `plugin/main.ts` and `ui/bootstrap.ts` are the only files that touch `figma` or
`document` as a side effect of being imported. Everything else takes its dependencies as parameters:
the pipeline gets a `DocumentPort`, storage gets a `StoragePort`, providers get a `Transport`. That
is what lets `npm test` run the whole generation pipeline — cloning, naming, cache hits, skipped
languages, cancellation — against fakes, with no Figma and no network.

---

## Tests

```bash
npm test
```

| File                   | Covers                                                                                                                                                |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pure.test.mjs`        | Hashing, frame naming, batching, placeholder protection, prompts, output parsing                                                                      |
| `text-engine.test.mjs` | Measurement and character-budget maths against fake nodes                                                                                             |
| `providers.test.mjs`   | Every provider against a scripted transport: batching, retry policy, redaction, DeepL key routing, the temperature fallback, the malformed-JSON nudge |
| `pipeline.test.mjs`    | `generate()` end to end against a fake document                                                                                                       |
| `storage.test.mjs`     | The v1 → v2 migration, quota caps, translation-memory bucketing                                                                                       |
| `registry.test.mjs`    | Registry invariants, and that `manifest.json` matches the code                                                                                        |
| `messages.test.mjs`    | Protocol validation — junk in, nothing out                                                                                                            |
| `warnings.test.mjs`    | Every warning code renders                                                                                                                            |
| `rpc.test.mjs`         | Request/reply and cancellation semantics                                                                                                              |

---

---

## How the engine behaves

The rest of this file is the reasoning behind what lands on your canvas.

## Fitting the copy to the layout

Machine translation has no idea how much room a caption has. The AI modes do, if you tell them, and
_Let the AI fit the copy to the layout_ (on by default) does exactly that in two steps:

1. **Before translating**, every layer is measured — how much space it has versus how much its
   current text uses — and that ratio becomes a character budget for the string. Where one string
   appears on several layers, the tightest one wins. The budget is never allowed below the source
   length (a translation no longer than the English it replaces always fits), and budgets looser
   than 1.6× the source are dropped as prompt noise. Strings that carry one arrive as
   `{"id": "…", "text": "…", "maxChars": 34}`.
2. **After writing**, anything that still overflows goes back in one batched request — not as a
   retranslation, but as _"say this shorter, in the same language, within N characters"_. The layer
   is reset to the designer's original font size before the fit runs again, so the 85% floor is
   measured against the design and not against the already-shrunk state. Only layers that still do
   not fit after that become warnings, and the summary counts how many were rescued.

Turning the option off restores the old behaviour: translate, shrink, warn.

---

## Layout handling

Translations are usually longer than English. Whatever the AI budget pass above did or did not
achieve, this is the backstop — deliberately conservative, and it runs in this order:

1. If it already fits, change nothing.
2. Let auto-layout absorb the extra height where the parent hugs its content.
3. Shrink the font in 2% steps, **never below 85%** of the original size.
4. Tighten letter spacing slightly (down to −1.5%).
5. Give up and raise a warning. It never shrinks indefinitely, never resizes the screenshot frame,
   and never restructures the layout.

If the source text already filled its box and the translation is much shorter, the font may grow —
capped at **105%**.

Available space is measured against the nearest fixed-size ancestor (and the screenshot root, which
is always treated as fixed), minus padding, minus what siblings occupy in a fixed-size auto-layout
parent. Fixed-size text boxes are measured by temporarily switching them to auto-height and
restoring them, so nothing is left resized.

---

## Warnings

The summary screen links to a list of `severity · language / frame / layer · problem`. Clicking an
entry selects that layer on the canvas. You'll see things like:

```
warn   DE / 01_Hero_DE / tight-label
       Text box exceeded the available height by 21px. Translation is 92% longer than the
       source. Auto-adjust hit its safe limit (font 86%).

info   JA / 01_Hero_JA / headline
       Verify that "Inter" contains CJK glyphs — Figma silently substitutes a fallback font.

error  FR / — / —
       Language skipped: Invalid or unauthorized API key (HTTP 401).
```

`info` entries are advisory and are not counted in the warning total. A failure never aborts the
batch: a dead language is skipped, a locked layer is skipped, everything else still generates, and
the summary reports what actually happened.

---

## Right-to-left

For Arabic the plugin mirrors `textAlignHorizontal` (LEFT ↔ RIGHT) on **every** text layer — including
the ones whose translation came back identical to the source, such as brand names and numbers, which
still have to sit on the right. It raises one note per frame. Figma's text engine already shapes
Arabic correctly. It deliberately does **not** mirror icon order, auto-layout direction or the visual
hierarchy — that stays your call.

---

## Translation memory

Identical source strings are translated once per language and reused everywhere. Results are also
cached in `figma.clientStorage`, keyed by **engine + model** + source language + target language +
source text, so re-running the same screenshots costs nothing.

The bucket has to name everything that changes the output. Sharing one bucket across engines meant
that switching from the free Google endpoint to DeepL replayed the old Google output, because the
cache hit meant DeepL was never asked — and the same was true of the model until it joined the key,
so moving from `gpt-4o-mini` to a newer model quietly replayed the old model's answers. Each provider
declares its own bucket (`cacheKey`) in the registry. DeepL Pro and Free share one — same engine,
different billing. Manual mode has no bucket at all: whatever you typed is always what gets written.

**Clear** in the last section wipes every bucket. The cache is local to your Figma install and never
leaves it.
