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

<p align="center">
  <img src="docs/images/panel-languages.png" width="46%" alt="The plugin panel: selected frames, a searchable list of 21 target languages, and the translation mode picker">
  <img src="docs/images/panel-options.png" width="46%" alt="The options section: layout and naming switches, the never-translate list, the glossary field and the debug logging toggle">
</p>

<p align="center"><em>Pick your languages and a mode, then tune how it handles your layout.</em></p>

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

| Command             | What it does                                                                   |
| ------------------- | ------------------------------------------------------------------------------ |
| `npm run build`     | Type-checks every project, then builds `dist/`                                 |
| `npm run watch`     | Rebuilds on save (re-run the plugin in Figma to pick it up)                    |
| `npm run typecheck` | Type-check only (plugin, UI and test projects)                                 |
| `npm test`          | Tests (`node --test`, no extra deps) — see [Tests](docs/architecture.md#tests) |
| `npm run clean`     | Delete `dist/` and `dist-test/`                                                |

---

## Using it

1. Select one or more frames on the canvas. Any frame works — no naming convention, no tagging, no
   special layer names. Groups, components and instances are fine too. Selecting a frame _and_
   something inside it is safe: the nested one is dropped so it is not duplicated twice.
2. The panel shows how many frames and text layers it found. **Refresh selection** re-scans.
3. Pick your source language and tick the target languages (searchable, multi-select).
4. Pick a translation mode.
5. Press **Generate Localized Screenshots**.

Each language gets its own column of frames placed to the right of everything already on the page,
so re-running never lands on top of your previous output. (Turn on _Update frames from an earlier
run_ if you would rather replace last run's frames in place.) When it finishes, the new frames are
selected and the viewport zooms to them.

Drag the bottom-right corner to resize the panel.

### Translation modes

| Mode                    | Key                     | Notes                                                      |
| ----------------------- | ----------------------- | ---------------------------------------------------------- |
| Manual                  | —                       | You type everything                                        |
| OpenAI                  | `Authorization: Bearer` | Best at following instructions and keeping copy punchy     |
| Gemini                  | `x-goog-api-key`        | Same, usually cheaper                                      |
| Google Translate        | `x-goog-api-key`        | Cloud Translation API. Fast, cheap, 64 strings per request |
| Google Translate (free) | none                    | Unofficial endpoint — drafts only, see the caveats         |
| DeepL                   | `DeepL-Auth-Key`        | Usually the best quality for European languages            |
| DeepL (Free API)        | `DeepL-Auth-Key`        | Same engine, 500k characters/month at no cost              |

Each mode's request shape, the batching and retry rules, the glossary and how
placeholders are protected: **[docs/providers.md](docs/providers.md)**.

### Options

| Option                                | Default | Behaviour                                                                                                                                                                   |
| ------------------------------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Create one folder/frame per language  | off     | Wraps each language's frames in a Section named `[DE] German` (falls back to a plain frame if Sections are unavailable)                                                     |
| Keep original frames unchanged        | **on**  | Sources are never touched. When **off**, sources are only _renamed_ with the source-language tag — never deleted or edited                                                  |
| Auto-adjust text when longer          | **on**  | Runs the fit algorithm below                                                                                                                                                |
| Detect text overflow                  | **on**  | Produces the warning list                                                                                                                                                   |
| Preserve original text formatting     | **on**  | Re-applies mixed character styling (see limitations)                                                                                                                        |
| Add language suffix to frame names    | **on**  | `Hero_DE`. Turn off for `[DE] Hero`                                                                                                                                         |
| Let the AI fit the copy to the layout | **on**  | AI modes only. Sends each string its measured character budget, then asks for a shorter wording for whatever still overflows                                                |
| Update frames from an earlier run     | off     | Replaces a frame of the same name in place — same position, same parent — instead of adding another column. The old frame is deleted                                        |
| Debug logging                         | off     | Logs the failures the plugin normally swallows (a locked layer, an unsupported property, storage over quota) to the developer console. Worth turning on before filing a bug |

Naming strips an existing language tag first, so `01_Hero_EN` becomes `01_Hero_DE`, not
`01_Hero_EN_DE`. Only tags that match a known language code are stripped — `Hero_V2` is left alone.

The layout rules behind _Auto-adjust_ and _Let the AI fit the copy to the layout_ —
what gets measured, what gets shrunk and when it gives up — are in
**[docs/architecture.md](docs/architecture.md#how-the-engine-behaves)**.

---

## Known limitations

- **Component instances.** Text inside instances is edited as an override, which Figma allows. If the
  layer is bound to a component _text property_, the plugin routes the change through
  `instance.setProperties()` instead. If Figma rejects both (locked layer, restricted nested
  instance), that layer is skipped with an `error` warning rather than failing the frame.
- **Mixed character styling.** Assigning `characters` collapses per-character styles to the first
  character's style — that's the Figma API, not a choice. With _Preserve original text formatting_
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

---

## Documentation

|                                                  |                                                                                                                       |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| **[docs/providers.md](docs/providers.md)**       | Every translation mode in detail, batching and retry, the glossary, placeholder protection, and how to add a provider |
| **[docs/architecture.md](docs/architecture.md)** | The four layers and why, the file tree, the ports that make it testable, and how the layout engine decides            |
| **[docs/privacy.md](docs/privacy.md)**           | Exactly what is stored and what leaves your machine                                                                   |
| **[CONTRIBUTING.md](CONTRIBUTING.md)**           | Setup, the two-runtime gotcha, and what a PR needs                                                                    |
| **[SECURITY.md](SECURITY.md)**                   | Scope, and how to report something privately                                                                          |

## Contributing

Bug reports, providers and languages are all welcome — a new provider is one file plus one
descriptor, and a new language is one object. See [CONTRIBUTING.md](CONTRIBUTING.md) for the setup
and the two or three things that are genuinely easy to get wrong.

For anything security-related — API key handling, network egress — please read
[SECURITY.md](SECURITY.md) and report it privately rather than opening an issue.

## License

[MIT](LICENSE) © Taha Bozdemir
