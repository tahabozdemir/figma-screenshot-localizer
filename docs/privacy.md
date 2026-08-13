# Privacy

There is no backend, no account, no telemetry and no database. This page is the
full account of what is stored and what leaves your machine.

← [README](../README.md) · [Providers](providers.md) · [Architecture](architecture.md)

---

## What is stored, and where

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

## Reporting a problem

If you find a way to make the plugin leak a key or reach a host outside the
allow-list, please report it privately — see [SECURITY.md](../SECURITY.md).
