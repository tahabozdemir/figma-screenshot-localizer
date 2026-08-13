/**
 * The seam between the pipeline and Figma itself.
 *
 * Everything document-level goes through these two interfaces, so the
 * generation pipeline — cloning, placement, replacement, cancellation, the
 * summary — can be driven by a fake in a plain Node test. Node-level text
 * manipulation deliberately stays outside: `text-engine.ts` talks to node
 * objects directly, and a plain object models those well enough to test
 * (which is how the measurement tests already work).
 */

import { swallow } from '../shared/log';

export interface DocumentPort {
  selection(): SceneNode[];
  setSelection(nodes: SceneNode[]): void;
  pageChildren(): readonly SceneNode[];
  appendToPage(node: SceneNode): void;
  /** Null when the running Figma build has no Sections API. */
  createSection(): SectionNode | null;
  createFrame(): FrameNode;
  scrollAndZoomIntoView(nodes: SceneNode[]): void;
  notify(message: string, options?: { error?: boolean }): void;
  getNodeById(id: string): Promise<BaseNode | null>;
}

export interface StoragePort {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
  remove(key: string): Promise<void>;
  keys(): Promise<string[]>;
}

export function createDocumentPort(): DocumentPort {
  return {
    selection: () => figma.currentPage.selection.slice(),
    setSelection: (nodes) => {
      figma.currentPage.selection = nodes;
    },
    pageChildren: () => figma.currentPage.children,
    appendToPage: (node) => figma.currentPage.appendChild(node),
    createSection: () => {
      // Older builds have no createSection; callers fall back to a frame.
      const api = figma as unknown as { createSection?: () => SectionNode };
      if (typeof api.createSection !== 'function') return null;
      try {
        return api.createSection();
      } catch (e) {
        swallow('createSection', e);
        return null;
      }
    },
    createFrame: () => figma.createFrame(),
    scrollAndZoomIntoView: (nodes) => figma.viewport.scrollAndZoomIntoView(nodes),
    notify: (message, options) => figma.notify(message, options),
    getNodeById: (id) => figma.getNodeByIdAsync(id),
  };
}

export function createStoragePort(): StoragePort {
  return {
    get: (key) => figma.clientStorage.getAsync(key),
    set: (key, value) => figma.clientStorage.setAsync(key, value),
    remove: (key) => figma.clientStorage.deleteAsync(key),
    keys: () => figma.clientStorage.keysAsync(),
  };
}
