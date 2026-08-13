# Screenshot Localizer

[![CI](https://github.com/tahabozdemir/figma-screenshot-localizer/actions/workflows/ci.yml/badge.svg)](https://github.com/tahabozdemir/figma-screenshot-localizer/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

An open-source Figma plugin that duplicates your App Store and Google Play screenshot frames and
replaces the text with translations, one set per language — locally, with your own API key or by
hand. Translate into 21 languages via OpenAI, Gemini, DeepL or Google Translate, with the copy fitted
to the layout it has to live in.

```
01_Hero_EN      →   01_Hero_DE   01_Hero_FR   01_Hero_ES …
02_Features_EN  →   02_Features_DE  …
03_Tracking_EN  →   03_Tracking_DE  …
```

Everything runs locally inside Figma. There is no backend, no account, no telemetry and no database.
The only network requests the plugin can make are to the translation provider you pick, with your own
API key — and Manual mode makes none at all.

---

## Setup

```bash
npm install
npm run build
```

Then in Figma (desktop app):

1. **Menu → Plugins → Development → Import plugin from manifest…**
2. Pick `manifest.json` in this folder.
3. Run it from **Plugins → Development → Screenshot Localizer**.

Other scripts:

| Command             | What it does                                              |
| ------------------- | --------------------------------------------------------- |
| `npm run build`     | Type-checks both projects, then builds `dist/`             |
| `npm run watch`     | Rebuilds on save (re-run the plugin in Figma to pick it up) |
| `npm run typecheck` | Type-check only                                            |
| `npm test`          | Tests (`node --test`, no extra deps) — see [Tests](#tests) |
| `npm run clean`     | Delete `dist/` and `dist-test/`                            |

---

## Using it

1. Select one or more frames on the canvas. Any frame works — no naming convention, no tagging, no
   special layer names. Groups, components and instances are fine too. Selecting a frame *and*
   something inside it is safe: the nested one is dropped so it is not duplicated twice.
2. The panel shows how many frames and text layers it found. **Refresh selection** re-scans.
3. Pick your source language and tick the target languages (searchable, multi-select).
4. Pick a translation mode.
5. Press **Generate Localized Screenshots**.

Each language gets its own column of frames placed to the right of everything already on the page,
so re-running never lands on top of your previous output. (Turn on *Update frames from an earlier
run* if you would rather replace last run's frames in place.) When it finishes, the new frames are
selected and the viewport zooms to them.

Drag the bottom-right corner to resize the panel.

### Translation modes

| Mode | Key | Notes |
| --- | --- | --- |
| Manual | — | You type everything |
| OpenAI | `Authorization: Bearer` | Best at following instructions and keeping copy punchy |
| Gemini | `x-goog-api-key` | Same, usually cheaper |
| Google Translate | `x-goog-api-key` | Cloud Translation API. Fast, cheap, 64 strings per request |
| Google Translate (free) | none | Unofficial endpoint — see the caveats below |
| DeepL | `DeepL-Auth-Key` | Usually the best quality for European languages |
| DeepL (Free API) | `DeepL-Auth-Key` | Same engine, 500k characters/month at no cost |

**Manual** — the plugin lists every unique string in the selection. Expand a language and type the
translations. `×3` next to a string means it appears on three layers; you translate it once. Entries
are saved to `figma.clientStorage` as you type, so closing the plugin does not lose them. Manual mode
deliberately ignores the translation memory: what you typed is always what gets written.

**OpenAI** — `POST https://api.openai.com/v1/chat/completions`. Default model `gpt-4o-mini`; the
model field is editable, so newer model ids work without a code change. The reasoning families
(`o3`, `o4-mini`, `gpt-5…`) reject any `temperature` but the default, so the parameter is dropped for
those ids — and if an unrecognised model returns a 400 naming the field, the request is retried
without it and the rest of the run remembers.

**Gemini** — `POST https://generativelanguage.googleapis.com/v1beta/models/<model>:generateContent`.
Default model `gemini-2.0-flash`. The key goes in the header, never the query string.

Both AI providers get a strict system prompt: preserve meaning, don't summarize, don't add
information, keep placeholders (`{{name}}`, `{count}`, `%s`, `%d`, `%1$s`, HTML-like tags) and emoji
verbatim, keep line breaks and capitalization, prefer the shortest natural phrasing, and return
strict JSON keyed by the exact input ids.

**Google Translate (Cloud API)** — `POST https://translation.googleapis.com/language/translate/v2`.
The key must belong to a project with the Cloud Translation API enabled; a 403 says so explicitly.
Requests use `format: html` so placeholders and your do-not-translate terms can be wrapped in
`<span translate="no">` (see *Protecting placeholders* below).

**Google Translate (free)** — the undocumented `translate.googleapis.com/translate_a/single`
endpoint behind Google's web widget. No key, no cost, and no guarantees:

- one request per string (it cannot batch), sent 3 at a time
- rate limited per machine; a 429 tells you to back off
- **no way to mark text as untranslatable**, so placeholders may come back as `{{ Name }}` — the
  plugin detects that and warns, but cannot prevent it
- undocumented and unsupported: Google may change or block it at any time, and automated use is
  outside their terms of service

Fine for a quick draft. Use the Cloud API or DeepL for anything you ship.

**DeepL** — `POST https://api.deepl.com/v2/translate` (Pro) or `https://api-free.deepl.com/v2/translate`
(Free). A key ending in `:fx` is a Free key; if it doesn't match the mode you picked, the plugin
routes to the correct endpoint anyway and notes it, rather than letting you hit a confusing 403.
Requests use `tag_handling: xml` with `ignore_tags: ["x"]` for placeholder protection. Quota
exhaustion (HTTP 456) is reported as such.

Strings are batched — 40 per request for the LLMs and DeepL, 64 for Google Cloud, never one request
per layer (the free Google endpoint being the exception it has to be). A batch that fails does not
discard the batches that succeeded.

Retries are deliberate about what is worth repeating:

| Failure | Retried? |
| --- | --- |
| Rate limit (429), server error (5xx) | Yes — up to 3 attempts, honouring `Retry-After` |
| Transport failure (dropped connection, CORS) | Yes — and through the other route (see below) |
| Auth/quota/bad request (401, 403, 413, 456) | No — the answer will not change |
| Unusable response (no `translations` array, blocked completion, prose instead of JSON) | No — but an LLM gets exactly one "reply with strict JSON" nudge first |

That last row matters: re-sending an identical request that the server already accepted produces an
identical useless answer, so treating it as transient just cost three requests and two backoff sleeps
before reporting the reason it already knew.

### Adding a translation provider

Everything about a provider lives in one descriptor in `src/providers/registry.ts`:

```ts
mistral: {
  id: 'mistral',
  label: 'Mistral',
  optionLabel: 'Mistral',
  group: 'ai',
  fields: [{ id: 'key', label: 'Mistral API key', type: 'password',
             credential: true, target: { scope: 'secret', key: 'mistralKey' } }],
  capabilities: { shorten: true, budgets: true },
  domains: ['https://api.mistral.ai'],
  cacheKey: (s) => 'mistral/' + s.settings.mistralModel,
  create: (s) => new MistralProvider({ transport: s.transport, apiKey: s.secrets.mistralKey, … }),
}
```

The panel builds its own controls from `fields`, validation reads `credential`, the sandbox is handed
`capabilities` and `cacheKey` instead of guessing them from the mode name, and there is no
provider-specific markup in `ui.html` at all. So the whole job is:

1. write `src/providers/<name>.ts` (implement `TranslationProvider`, take a `Transport`)
2. add the descriptor to `PROVIDERS` and `PROVIDER_LIST`
3. add the id to `TranslationMode` in `src/shared/types.ts`
4. add the host to `manifest.json`, and the key field to `Secrets` if it needs one

`PROVIDERS` is typed `Record<TranslationMode, ProviderDescriptor>`, so step 3 without step 2 is a
compile error. A test compares `allDomains()` against the manifest allow-list, so step 4 cannot be
forgotten either.

### Glossary

`Never translate` keeps a term in English. The glossary is the other half: terms that *should* be
translated, but always the same way. One per line, in the Options section:

```
Streak = TR: Seri, DE: Serie, FR: Série
Focus mode = DE: Fokusmodus
```

Only the lines for the language being generated are sent, appended to the system prompt as approved
translations to inflect into the sentence. Lines that do not parse are skipped rather than rejected,
and the panel shows how many terms it understood plus any language code it does not recognise.

Glossaries apply to the **AI modes only** — Google and DeepL have no equivalent in the request shape
this plugin uses, so the field is ignored there.

### Fitting the copy to the layout

Machine translation has no idea how much room a caption has. The AI modes do, if you tell them, and
*Let the AI fit the copy to the layout* (on by default) does exactly that in two steps:

1. **Before translating**, every layer is measured — how much space it has versus how much its
   current text uses — and that ratio becomes a character budget for the string. Where one string
   appears on several layers, the tightest one wins. The budget is never allowed below the source
   length (a translation no longer than the English it replaces always fits), and budgets looser
   than 1.6× the source are dropped as prompt noise. Strings that carry one arrive as
   `{"id": "…", "text": "…", "maxChars": 34}`.
2. **After writing**, anything that still overflows goes back in one batched request — not as a
   retranslation, but as *"say this shorter, in the same language, within N characters"*. The layer
   is reset to the designer's original font size before the fit runs again, so the 85% floor is
   measured against the design and not against the already-shrunk state. Only layers that still do
   not fit after that become warnings, and the summary counts how many were rescued.

Turning the option off restores the old behaviour: translate, shrink, warn.

### Protecting placeholders

Machine translation will happily "translate" `{{name}}` into `{{ Name }}` and turn your product name
into a common noun. Before sending, the plugin finds every placeholder (`{{x}}`, `{x}`, `%s`, `%d`,
`%1$s`, `<b>…</b>`, `[[x]]`) plus every term in **Never translate**, and wraps those spans in the
engine's do-not-translate element — `<span translate="no">` for Google, `<x>` for DeepL. The wrapper
is stripped from the result and entities are decoded, so what lands in Figma is the original token.

Whatever the engine does, the output is checked: anything that went in as a placeholder or a
protected noun and didn't come out is reported in the warning list.

### Why requests sometimes go through the plugin sandbox

The plugin UI is a normal browser iframe, so it is bound by CORS — and **DeepL deliberately sends no
CORS headers**. Figma's plugin sandbox has its own `fetch` that is proxied by the app and is not
subject to CORS, so DeepL requests are routed there over a message round-trip. Everything else uses
the browser directly and falls back to the sandbox only if the transport fails. Either way, requests
can only reach the domains allow-listed in `manifest.json`.

### Options

| Option                             | Default | Behaviour                                                                                                     |
| ---------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------- |
| Create one folder/frame per language | off     | Wraps each language's frames in a Section named `[DE] German` (falls back to a plain frame if Sections are unavailable) |
| Keep original frames unchanged     | **on**  | Sources are never touched. When **off**, sources are only *renamed* with the source-language tag — never deleted or edited |
| Auto-adjust text when longer       | **on**  | Runs the fit algorithm below                                                                                   |
| Detect text overflow               | **on**  | Produces the warning list                                                                                      |
| Preserve original text formatting  | **on**  | Re-applies mixed character styling (see limitations)                                                           |
| Add language suffix to frame names | **on**  | `Hero_DE`. Turn off for `[DE] Hero`                                                                            |
| Let the AI fit the copy to the layout | **on** | AI modes only. Sends each string its measured character budget, then asks for a shorter wording for whatever still overflows |
| Update frames from an earlier run  | off     | Replaces a frame of the same name in place — same position, same parent — instead of adding another column. The old frame is deleted |
| Debug logging                      | off     | Logs the failures the plugin normally swallows (a locked layer, an unsupported property, storage over quota) to the developer console. Worth turning on before filing a bug |

Naming strips an existing language tag first, so `01_Hero_EN` becomes `01_Hero_DE`, not
`01_Hero_EN_DE`. Only tags that match a known language code are stripped — `Hero_V2` is left alone.

### Layout handling

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

### Warnings

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

### Right-to-left

For Arabic the plugin mirrors `textAlignHorizontal` (LEFT ↔ RIGHT) on **every** text layer — including
the ones whose translation came back identical to the source, such as brand names and numbers, which
still have to sit on the right. It raises one note per frame. Figma's text engine already shapes
Arabic correctly. It deliberately does **not** mirror icon order, auto-layout direction or the visual
hierarchy — that stays your call.

### Translation memory

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

---

## Privacy

- Each API key is stored in `figma.clientStorage` (local to your machine) and sent only in the auth
  header of the request to the provider you selected. Keys are never put in a URL.
- Keys live under their own storage key (`lsl.secrets.v1`), separate from the settings blob, and are
  written when a field is committed rather than on every keystroke. An older install that kept them
  in `lsl.settings.v1` is migrated on first load, and the old blob — plaintext keys and all — is
  deleted **only once both new keys are confirmed written**; if storage is full the old copy is kept
  and the migration is retried next launch.
- Keys are never logged, and provider error messages are redacted before being displayed.
- `manifest.json` allows exactly six domains and nothing else: `api.openai.com`,
  `generativelanguage.googleapis.com`, `translation.googleapis.com`, `translate.googleapis.com`,
  `api.deepl.com`, `api-free.deepl.com`.
- Only the text strings are sent — never the design, images or layer structure. In the AI modes each
  string may carry a `maxChars` number measured from your layout; that number is the only thing about
  the design that ever leaves Figma.
- Manual translations are stored in `figma.clientStorage` on your machine and are never sent anywhere
  — Manual mode makes zero network requests.

---

## Known limitations

- **Component instances.** Text inside instances is edited as an override, which Figma allows. If the
  layer is bound to a component *text property*, the plugin routes the change through
  `instance.setProperties()` instead. If Figma rejects both (locked layer, restricted nested
  instance), that layer is skipped with an `error` warning rather than failing the frame.
- **Mixed character styling.** Assigning `characters` collapses per-character styles to the first
  character's style — that's the Figma API, not a choice. With *Preserve original text formatting*
  on, the original segments are re-applied over proportional ranges of the translated string, snapped
  to the nearest word boundary, and the layer gets an `info` warning. For a bold word in the middle
  of a sentence the split will usually land close but not exactly right; check those layers.
- **Fonts.** A font that isn't available in the file can't be edited, so that layer is skipped. A
  Latin-only font won't magically gain CJK or Arabic glyphs; the plugin can't inspect glyph coverage,
  so it raises one advisory note per font/script pair.
- **Duplicate strings.** Two layers with identical source text always get the same translation.
  Strings are matched by a hash of their content; before writing, the hash is verified against the
  source text it was derived from, so the one-in-a-very-large-number collision produces a skipped
  layer and an `error` warning rather than a layer silently receiving another layer's translation.
- **Hidden layers inside instances are skipped.** They are not rendered in a screenshot, so
  translating them would be pure cost — and skipping them makes the layer scan much faster.
- **Character budgets are an estimate.** Capacity is derived from the ratio of available space to the
  space the current text uses; character count does not scale linearly with box area. The model
  treats it as a hint, and the conservative fit pass is still the thing that guarantees nothing
  silently overflows.
- **Machine translation has no context.** Google and DeepL see one caption at a time with no idea
  that it is a headline in a screenshot, so they will not shorten copy to fit or pick the punchier
  of two valid phrasings the way the LLM modes are told to. For hero headlines, the AI modes or
  Manual usually win; for body copy and feature lists, DeepL is typically the fastest good answer.
- **DeepL language coverage.** All 21 languages here are supported, but DeepL picks the variant:
  `EN` becomes `EN-US`, `PT` becomes `PT-PT`, `NO` becomes `NB`. Change it in
  `src/languages.ts` (`DEEPL_TARGET_CODES`) if you want `EN-GB` or `PT-BR`.
- **Overflow detection** relies on Figma's own text measurement. Text that is clipped by an ancestor
  with `clipsContent` several levels up may still need a human eye.

---

## Architecture

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
│   │   ├── languages.ts     The 21 languages (incl. their per-engine codes) + frame tagging
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
│   │   ├── layout.ts        Bounds, column origins, containers, finding an earlier run
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

### Tests

```bash
npm test
```

| File | Covers |
| --- | --- |
| `pure.test.mjs` | Hashing, frame naming, batching, placeholder protection, prompts, output parsing |
| `text-engine.test.mjs` | Measurement and character-budget maths against fake nodes |
| `providers.test.mjs` | Every provider against a scripted transport: batching, retry policy, redaction, DeepL key routing, the temperature fallback, the malformed-JSON nudge |
| `pipeline.test.mjs` | `generate()` end to end against a fake document |
| `storage.test.mjs` | The v1 → v2 migration, quota caps, translation-memory bucketing |
| `registry.test.mjs` | Registry invariants, and that `manifest.json` matches the code |
| `messages.test.mjs` | Protocol validation — junk in, nothing out |
| `warnings.test.mjs` | Every warning code renders |
| `rpc.test.mjs` | Request/reply and cancellation semantics |

---

## Troubleshooting

**"Select at least one frame"** — select the frame itself on the canvas, not a text layer inside it.

**Changes don't show up** — after `npm run build`, close and re-run the plugin. `npm run watch`
rebuilds automatically but Figma still needs the plugin re-run.

**Everything came back untranslated** — check the warning list; an invalid key shows up as
`Language skipped: Invalid or unauthorized API key (HTTP 401)`.

**A model id stopped working** — edit the model field in the panel; it's free text and is saved.

**DeepL returns 403** — the key is wrong, or it's a Free key being used as Pro. The plugin normally
auto-routes by the `:fx` suffix, so a 403 usually means the key itself is bad.

**Google Translate returns 403** — the key is valid but its project doesn't have the Cloud
Translation API enabled, or billing isn't set up.

**"This Figma version cannot make requests from the plugin sandbox"** — DeepL needs the sandbox
`fetch` to get around CORS. Update the Figma desktop app, or use Google/OpenAI/Gemini instead.

---

## Contributing

Bug reports, providers and languages are all welcome — a new provider is one file plus one
descriptor, and a new language is one object. See [CONTRIBUTING.md](CONTRIBUTING.md) for the setup
and the two or three things that are genuinely easy to get wrong.

For anything security-related — API key handling, network egress — please read
[SECURITY.md](SECURITY.md) and report it privately rather than opening an issue.

## License

[MIT](LICENSE) © Taha Bozdemir
