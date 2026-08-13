# Security Policy

## What this plugin handles

It stores API keys for the translation provider you choose, and it can make network requests. That is
the whole of its attack surface — there is no backend, no account and no telemetry.

Specifically:

- Keys live in `figma.clientStorage` under `lsl.secrets.v1`, local to your Figma install. Figma's
  client storage is **not encrypted**; anyone with access to your machine and the Figma developer
  console can read it. Treat it like any other credential file on disk.
- Keys are sent only in the auth header of the request to the provider you selected, never in a URL.
- Provider error messages are redacted before being displayed, so a key echoed back by an API does
  not end up in the warning list.
- `manifest.json` allow-lists exactly six hosts. A plugin cannot reach anything else, and a test
  asserts that the allow-list matches the domains the code actually uses.
- Only the text strings are sent — never the design, images or layer structure. In the AI modes each
  string may carry a `maxChars` number measured from your layout; that number is the only thing about
  the design that leaves Figma.
- Manual mode makes zero network requests.

## Reporting a vulnerability

Please **do not open a public issue** for a security problem.

Use GitHub's private vulnerability reporting: go to the **Security** tab → _Report a vulnerability_.
That opens a private advisory only the maintainers can see.

Useful things to include: what an attacker controls, what they get, and the smallest reproduction you
have. A Figma file that triggers it is ideal.

You should get a first response within a week. This is a side project maintained by one person, so
please be patient with the timeline — but anything involving key disclosure or arbitrary network
egress will be treated as urgent.

## Scope

In scope:

- Anything that leaks an API key outside the request to its own provider
- Anything that reaches a host outside `manifest.json`'s allow-list
- Content in a Figma document (a layer name, a text string) that can escape into markup, a prompt in
  a way that exfiltrates data, or a request
- Storage handling that destroys or exposes credentials

Out of scope:

- The fact that `figma.clientStorage` is unencrypted — that is Figma's storage model, documented above
- Anything requiring an attacker to already have your unlocked machine
- Quality of a translation, or a provider's own security
- The free Google endpoint being undocumented and unsupported — that is a stated caveat, not a bug

## Supported versions

The `main` branch is the only supported version. There are no backports.
