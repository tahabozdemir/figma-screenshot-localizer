# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.0.0] — 2026-08-14

Initial public release.

### Added

- Duplicates the selected frames once per target language and writes the translations back, across
  21 languages.
- Seven translation modes: Manual, OpenAI, Gemini, Google Cloud Translation, the free Google
  endpoint, DeepL Pro and DeepL Free.
- Layout-aware copy fitting for the AI modes: each string is sent the character budget its box
  actually has, and anything that still overflows goes back for a shorter wording.
- Conservative auto-fit as a backstop — font 85–105%, slight letter-spacing, then a warning. It never
  resizes the frame or restructures the layout.
- Placeholder and proper-noun protection, verified on the way back out.
- Glossary for forced term translations, per target language.
- Translation memory in `figma.clientStorage`, bucketed by engine *and* model.
- A warning list linked to the canvas: click an entry to select the offending layer.
- Right-to-left handling: mirrored text alignment, with the icon and layout order left to you.
- Debug logging switch that surfaces the failures the plugin otherwise ignores.

### Security

- API keys are stored under their own storage key, written on commit rather than on every keystroke,
  sent only in the auth header of the provider you picked, and redacted out of error messages.
- `manifest.json` allow-lists exactly the six hosts the providers use; a test keeps the two in sync.

[Unreleased]: https://github.com/tahabozdemir/figma-screenshot-localizer/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/tahabozdemir/figma-screenshot-localizer/releases/tag/v1.0.0
