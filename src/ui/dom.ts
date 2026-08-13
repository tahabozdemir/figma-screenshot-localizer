/**
 * The element builder.
 *
 * The panel used to render half its lists by concatenating HTML strings and
 * hand-escaping every interpolation, and the other half with `createElement`.
 * One forgotten escape in a plugin that holds API keys and can make network
 * requests is a real hole, so the string path is gone: there is no way to pass
 * markup through this helper, and `text` always goes in as `textContent`.
 */

export interface ElProps {
  class?: string;
  id?: string;
  /** Always assigned as textContent — never parsed as markup. */
  text?: string;
  title?: string;
  type?: string;
  name?: string;
  value?: string;
  placeholder?: string;
  rows?: number;
  checked?: boolean;
  disabled?: boolean;
  autocomplete?: string;
  spellcheck?: boolean;
  dataset?: Record<string, string>;
}

export type Child = Node | string | null | undefined | false;

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props?: ElProps,
  children?: Child[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (props) {
    if (props.class) node.className = props.class;
    if (props.id) node.id = props.id;
    if (props.title) node.title = props.title;
    if (props.text !== undefined) node.textContent = props.text;
    if (props.autocomplete !== undefined) node.setAttribute('autocomplete', props.autocomplete);
    if (props.spellcheck !== undefined) node.spellcheck = props.spellcheck;
    if (props.disabled !== undefined) (node as unknown as { disabled: boolean }).disabled = props.disabled;

    const input = node as unknown as {
      type?: string;
      name?: string;
      value?: string;
      placeholder?: string;
      rows?: number;
      checked?: boolean;
    };
    if (props.type !== undefined) input.type = props.type;
    if (props.name !== undefined) input.name = props.name;
    if (props.value !== undefined) input.value = props.value;
    if (props.placeholder !== undefined) input.placeholder = props.placeholder;
    if (props.rows !== undefined) input.rows = props.rows;
    if (props.checked !== undefined) input.checked = props.checked;

    if (props.dataset) {
      for (const key of Object.keys(props.dataset)) node.dataset[key] = props.dataset[key];
    }
  }
  if (children) {
    for (const child of children) {
      if (child === null || child === undefined || child === false) continue;
      node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
    }
  }
  return node;
}

export function $<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error('Missing element #' + id);
  return found as T;
}

export function clear(node: HTMLElement): void {
  while (node.firstChild) node.removeChild(node.firstChild);
}

export function replace(node: HTMLElement, children: Child[]): void {
  clear(node);
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
  }
}

export function setHidden(node: HTMLElement, hidden: boolean): void {
  node.classList.toggle('hidden', hidden);
}
