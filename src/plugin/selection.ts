/**
 * Reading the canvas selection.
 *
 * One traversal produces everything downstream needs — the frame list, the text
 * count and the deduplicated string table. The two used to be built by two
 * near-identical loops that had to agree about what counts as a string; they
 * are one function now.
 */

import { hashString } from '../shared/util';
import type { FrameSummary, SourceString } from '../shared/types';
import type { DocumentPort } from './figma-port';
import { collectTextNodes } from './text-engine';

export const CLONEABLE: SceneNode['type'][] = [
  'FRAME',
  'COMPONENT',
  'COMPONENT_SET',
  'INSTANCE',
  'GROUP',
];

export interface SelectionScan {
  /** The roots that will be cloned. */
  nodes: SceneNode[];
  frames: FrameSummary[];
  textCount: number;
  /** Unique, non-blank strings across the whole selection. */
  strings: SourceString[];
}

/**
 * Cloneable nodes in the selection, minus anything that already sits inside
 * another selected node — selecting a frame *and* one of its children would
 * otherwise duplicate the child, once nested and once standalone.
 */
export function selectedContainers(doc: DocumentPort): SceneNode[] {
  const picked = doc.selection().filter((n) => CLONEABLE.indexOf(n.type) >= 0);
  if (picked.length < 2) return picked;
  const ids: Record<string, true> = {};
  for (const node of picked) ids[node.id] = true;
  return picked.filter((node) => {
    let parent: BaseNode | null = node.parent;
    while (parent) {
      if (ids[parent.id]) return false;
      parent = parent.parent;
    }
    return true;
  });
}

/** Deduplicates by content hash; `count` is how many layers carry the string. */
export function scanNodes(nodes: SceneNode[]): SelectionScan {
  const frames: FrameSummary[] = [];
  const map = new Map<string, SourceString>();
  let textCount = 0;

  for (const node of nodes) {
    const texts = collectTextNodes(node);
    frames.push({ id: node.id, name: node.name, textCount: texts.length });
    textCount += texts.length;
    for (const text of texts) {
      const value = text.characters;
      if (!value || !value.trim()) continue;
      const id = hashString(value);
      const existing = map.get(id);
      if (existing) existing.count++;
      else map.set(id, { id, text: value, count: 1 });
    }
  }

  return { nodes, frames, textCount, strings: Array.from(map.values()) };
}

export function scanSelection(doc: DocumentPort): SelectionScan {
  return scanNodes(selectedContainers(doc));
}
