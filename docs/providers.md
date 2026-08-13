# Translation providers

How each engine is called, what protects your placeholders on the way through,
and how to add another one.

← [README](../README.md) · [Architecture](architecture.md) · [Privacy](privacy.md)

---

## Translation modes

| Mode                    | Key                     | Notes                                                      |
| ----------------------- | ----------------------- | ---------------------------------------------------------- |
| Manual                  | —                       | You type everything                                        |
| OpenAI                  | `Authorization: Bearer` | Best at following instructions and keeping copy punchy     |
| Gemini                  | `x-goog-api-key`        | Same, usually cheaper                                      |
| Google Translate        | `x-goog-api-key`        | Cloud Translation API. Fast, cheap, 64 strings per request |
| Google Translate (free) | none                    | Unofficial endpoint — see the caveats below                |
| DeepL                   | `DeepL-Auth-Key`        | Usually the best quality for European languages            |
| DeepL (Free API)        | `DeepL-Auth-Key`        | Same engine, 500k characters/month at no cost              |

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
`<span translate="no">` (see _Protecting placeholders_ below).

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

| Failure                                                                                | Retried?                                                              |
| -------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Rate limit (429), server error (5xx)                                                   | Yes — up to 3 attempts, honouring `Retry-After`                       |
| Transport failure (dropped connection, CORS)                                           | Yes — and through the other route (see below)                         |
| Auth/quota/bad request (401, 403, 413, 456)                                            | No — the answer will not change                                       |
| Unusable response (no `translations` array, blocked completion, prose instead of JSON) | No — but an LLM gets exactly one "reply with strict JSON" nudge first |

That last row matters: re-sending an identical request that the server already accepted produces an
identical useless answer, so treating it as transient just cost three requests and two backoff sleeps
before reporting the reason it already knew.

---

## Adding a translation provider

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

---

## Glossary

`Never translate` keeps a term in English. The glossary is the other half: terms that _should_ be
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

---

## Protecting placeholders

Machine translation will happily "translate" `{{name}}` into `{{ Name }}` and turn your product name
into a common noun. Before sending, the plugin finds every placeholder (`{{x}}`, `{x}`, `%s`, `%d`,
`%1$s`, `<b>…</b>`, `[[x]]`) plus every term in **Never translate**, and wraps those spans in the
engine's do-not-translate element — `<span translate="no">` for Google, `<x>` for DeepL. The wrapper
is stripped from the result and entities are decoded, so what lands in Figma is the original token.

Whatever the engine does, the output is checked: anything that went in as a placeholder or a
protected noun and didn't come out is reported in the warning list.

---

## Why requests sometimes go through the plugin sandbox

The plugin UI is a normal browser iframe, so it is bound by CORS — and **DeepL deliberately sends no
CORS headers**. Figma's plugin sandbox has its own `fetch` that is proxied by the app and is not
subject to CORS, so DeepL requests are routed there over a message round-trip. Everything else uses
the browser directly and falls back to the sandbox only if the transport fails. Either way, requests
can only reach the domains allow-listed in `manifest.json`.
