/**
 * The one HTML/XML escaper. Used by the machine-translation providers, which
 * wrap protected spans in markup the engine has to parse.
 *
 * Deliberately only `& < >` — the minimal set that makes text content safe in
 * both HTML and XML. Quotes are left alone: we never build attributes with
 * this, and apostrophes are far too common in UI copy to be worth round-
 * tripping through an entity on every request.
 *
 * The UI does not use this at all: it builds nodes with `createElement` and
 * assigns `textContent`, so there is no escaping step to forget.
 */
export function escapeMarkup(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
