/**
 * Where the generated frames go: bounding boxes, the output grid each language
 * lands in, the optional per-language container, and finding what an earlier
 * run left behind.
 */

import { swallow } from '../shared/log';
import type { LanguageDef } from '../shared/types';
import type { DocumentPort } from './figma-port';
import { CLONEABLE } from './selection';

/** Gap between language groups, both down the column and across to the next. */
export const GROUP_GAP = 240;
/** How many languages stack below each other before a new column starts. */
export const LANGS_PER_COLUMN = 5;
/** Breathing room inside a per-language container. */
export const CONTAINER_PADDING = 96;

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type Container = SectionNode | FrameNode;

export function absBox(node: SceneNode): Box {
  const box = 'absoluteBoundingBox' in node ? node.absoluteBoundingBox : null;
  if (box) return box;
  return {
    x: 'x' in node ? node.x : 0,
    y: 'y' in node ? node.y : 0,
    width: 'width' in node ? node.width : 0,
    height: 'height' in node ? node.height : 0,
  };
}

export function unionBounds(nodes: SceneNode[]): Box {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const node of nodes) {
    const b = absBox(node);
    minX = Math.min(minX, b.x);
    minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.width);
    maxY = Math.max(maxY, b.y + b.height);
  }
  if (!isFinite(minX)) return { x: 0, y: 0, width: 0, height: 0 };
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/**
 * Where the output grid starts: aligned with the sources' left edge, below
 * everything already on the page. Clearing the full page bottom means a second
 * run lands under the first instead of on top of it.
 */
export function gridOrigin(doc: DocumentPort, bounds: Box): { x: number; y: number } {
  let bottom = bounds.y + bounds.height;
  for (const child of doc.pageChildren()) {
    const box = absBox(child);
    bottom = Math.max(bottom, box.y + box.height);
  }
  return { x: bounds.x, y: bottom + GROUP_GAP };
}

/** A Section if this Figma build has them, otherwise an unfilled frame. */
export function createContainer(
  doc: DocumentPort,
  lang: LanguageDef,
  originX: number,
  originY: number,
  bounds: Box
): Container | null {
  const name = '[' + lang.code + '] ' + lang.name;
  const w = bounds.width + CONTAINER_PADDING * 2;
  const h = bounds.height + CONTAINER_PADDING * 2;

  const section = doc.createSection();
  if (section) {
    try {
      section.name = name;
      doc.appendToPage(section);
      const resizable = section as unknown as {
        resizeWithoutConstraints?: (w: number, h: number) => void;
        resize?: (w: number, h: number) => void;
      };
      if (resizable.resizeWithoutConstraints) resizable.resizeWithoutConstraints(w, h);
      else if (resizable.resize) resizable.resize(w, h);
      section.x = originX - CONTAINER_PADDING;
      section.y = originY - CONTAINER_PADDING;
      return section;
    } catch (e) {
      swallow('createContainer: section, falling back to a frame', e);
    }
  }

  try {
    const frame = doc.createFrame();
    frame.name = name;
    frame.fills = [];
    frame.clipsContent = false;
    doc.appendToPage(frame);
    frame.resize(w, h);
    frame.x = originX - CONTAINER_PADDING;
    frame.y = originY - CONTAINER_PADDING;
    return frame;
  } catch (e) {
    swallow('createContainer: frame', e);
    return null;
  }
}

/**
 * Frames an earlier run left behind, indexed by name. Sections and container
 * frames are looked into one level deep, which covers the "one folder per
 * language" layout without a full-page scan.
 */
export function indexExistingByName(
  doc: DocumentPort,
  exclude: Record<string, true>
): Map<string, SceneNode> {
  const map = new Map<string, SceneNode>();
  const consider = (node: SceneNode) => {
    if (exclude[node.id] || map.has(node.name)) return;
    if (CLONEABLE.indexOf(node.type) < 0) return;
    map.set(node.name, node);
  };
  for (const child of doc.pageChildren()) {
    consider(child);
    if (child.type === 'SECTION' || child.type === 'FRAME') {
      for (const grandchild of child.children) consider(grandchild);
    }
  }
  return map;
}
