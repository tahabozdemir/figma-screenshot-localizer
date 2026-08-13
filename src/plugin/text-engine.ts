/**
 * All Figma text manipulation: discovery, font loading, style-preserving text
 * replacement, measurement, overflow detection and the conservative auto-fit.
 *
 * Runs in the plugin sandbox only. It talks to node objects rather than to the
 * `figma` global (apart from `loadFontAsync` and `figma.mixed`), which is what
 * lets the measurement tests drive it with plain objects.
 */

import { swallow } from '../shared/log';

/* Segment fields we read. Kept as a plain array + `any` casts so the module
 * keeps working across @figma/plugin-typings versions. */
const SEGMENT_FIELDS = [
  'fontName',
  'fontSize',
  'textDecoration',
  'textCase',
  'lineHeight',
  'letterSpacing',
  'fills',
  'hyperlink',
  'indentation',
  'listOptions',
] as const;

/** Tolerance in px before we call something an overflow. */
const TOL = 0.75;

/** Auto-fit guard rails (see README "Layout handling"). */
export const MIN_FONT_SCALE = 0.85;
export const MAX_FONT_SCALE = 1.05;
const SHRINK_STEP = 0.02;
const GROW_STEP = 0.01;
const LETTER_SPACING_STEPS = [-0.5, -1, -1.5];
const ABSOLUTE_MIN_FONT_SIZE = 6;

export interface Available {
  w: number;
  h: number;
}

export interface Metrics {
  w: number;
  h: number;
}

export type ApplyMode = 'uniform' | 'remapped' | 'property' | 'failed';

export interface FitResult {
  fits: boolean;
  fontScale: number;
  letterSpacingDelta: number;
  overflowH: number;
  overflowW: number;
}

/* ------------------------------------------------------------------ */
/* Discovery                                                           */
/* ------------------------------------------------------------------ */

/** Every TEXT descendant, including inside groups, components and instances. */
export function collectTextNodes(root: SceneNode): TextNode[] {
  if (root.type === 'TEXT') return [root];
  const container = root as SceneNode & ChildrenMixin;
  if (!('children' in container)) return [];
  try {
    return container.findAllWithCriteria({ types: ['TEXT'] }) as TextNode[];
  } catch (e) {
    swallow('collectTextNodes: findAllWithCriteria unavailable', e);
    return container.findAll((n) => n.type === 'TEXT') as TextNode[];
  }
}

/* ------------------------------------------------------------------ */
/* Fonts                                                               */
/* ------------------------------------------------------------------ */

export function fontsOf(node: TextNode): FontName[] {
  const out: FontName[] = [];
  const fn = node.fontName;
  if (fn !== figma.mixed) {
    out.push(fn as FontName);
    return out;
  }
  try {
    const segs = node.getStyledTextSegments(['fontName']) as Array<{ fontName: FontName }>;
    for (const s of segs) out.push(s.fontName);
  } catch (e) {
    swallow('fontsOf: getStyledTextSegments', e);
  }
  return out;
}

export function fontKey(f: FontName): string {
  return f.family + ' ' + f.style;
}

/**
 * Loads every font used by the given nodes exactly once per session.
 * Fonts that cannot be loaded land in `failed`, and their layers are skipped.
 */
export async function loadFontsFor(
  nodes: TextNode[],
  loaded: Set<string>,
  failed: Set<string>
): Promise<void> {
  const pending: FontName[] = [];
  for (const node of nodes) {
    for (const f of fontsOf(node)) {
      const key = fontKey(f);
      if (loaded.has(key) || failed.has(key)) continue;
      loaded.add(key);
      pending.push(f);
    }
  }
  for (const f of pending) {
    try {
      await figma.loadFontAsync(f);
    } catch (e) {
      swallow('loadFontAsync ' + fontKey(f), e);
      loaded.delete(fontKey(f));
      failed.add(fontKey(f));
    }
  }
}

export function nodeHasUnloadableFont(node: TextNode, failed: Set<string>): FontName | null {
  for (const f of fontsOf(node)) {
    if (failed.has(fontKey(f))) return f;
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Measurement                                                         */
/* ------------------------------------------------------------------ */

/**
 * Size the text *wants* at its current width. For fixed-size nodes we flip
 * textAutoResize to HEIGHT, read, then restore size and mode. Restoring is
 * done in a finally block so a throw mid-way cannot leave the node resized.
 */
export function measureNatural(node: TextNode): Metrics {
  const mode = node.textAutoResize;
  if (mode === 'HEIGHT' || mode === 'WIDTH_AND_HEIGHT') {
    return { w: node.width, h: node.height };
  }
  const prevW = node.width;
  const prevH = node.height;
  let result: Metrics = { w: prevW, h: prevH };
  try {
    node.textAutoResize = 'HEIGHT';
    result = { w: node.width, h: node.height };
  } catch (e) {
    swallow('measureNatural: could not switch to auto-height', e);
    return { w: prevW, h: prevH };
  } finally {
    try {
      node.textAutoResize = mode;
    } catch (e) {
      swallow('measureNatural: could not restore textAutoResize', e);
    }
    try {
      if (Math.abs(node.width - prevW) > 0.01 || Math.abs(node.height - prevH) > 0.01) {
        node.resize(prevW, prevH);
      }
    } catch (e) {
      swallow('measureNatural: could not restore size', e);
    }
  }
  return result;
}

/**
 * How much room the layer actually has before it collides with a fixed-size
 * ancestor. Hugging auto-layout ancestors are skipped (they grow with the
 * content) — except the screenshot root, which we never allow to resize.
 */
export function availableFor(node: TextNode, root: SceneNode): Available {
  const nb = node.absoluteBoundingBox;
  if (!nb) return { w: Infinity, h: Infinity };

  let w = Infinity;
  let h = Infinity;

  let cur: BaseNode | null = node.parent;
  while (cur && cur.type !== 'PAGE' && cur.type !== 'DOCUMENT') {
    const n = cur as SceneNode;
    const box = 'absoluteBoundingBox' in n ? n.absoluteBoundingBox : null;
    if (box) {
      const frame = n as FrameNode;
      const auto = 'layoutMode' in frame && frame.layoutMode !== 'NONE';
      let hugsH = false;
      let hugsV = false;
      let padR = 0;
      let padB = 0;
      if (auto) {
        padR = frame.paddingRight || 0;
        padB = frame.paddingBottom || 0;
        if (frame.layoutMode === 'VERTICAL') {
          hugsV = frame.primaryAxisSizingMode === 'AUTO';
          hugsH = frame.counterAxisSizingMode === 'AUTO';
        } else {
          hugsH = frame.primaryAxisSizingMode === 'AUTO';
          hugsV = frame.counterAxisSizingMode === 'AUTO';
        }
      }
      const isRoot = n.id === root.id;
      if (isRoot || !hugsV) h = Math.min(h, box.y + box.height - padB - nb.y);
      if (isRoot || !hugsH) w = Math.min(w, box.x + box.width - padR - nb.x);
    }
    if (cur.id === root.id) break;
    cur = cur.parent;
  }

  // Inside a fixed-size auto-layout parent the siblings eat into the budget.
  const parent = node.parent;
  if (parent && 'layoutMode' in parent) {
    const frame = parent as FrameNode;
    const kids = frame.children.filter((k) => k.visible);
    const gapCount = Math.max(0, kids.length - 1);
    const spacing =
      frame.primaryAxisAlignItems === 'SPACE_BETWEEN' || typeof frame.itemSpacing !== 'number'
        ? 0
        : frame.itemSpacing;
    if (frame.layoutMode === 'VERTICAL' && frame.primaryAxisSizingMode === 'FIXED') {
      let others = 0;
      for (const k of kids) if (k.id !== node.id) others += k.height;
      const inner =
        frame.height - (frame.paddingTop || 0) - (frame.paddingBottom || 0) - others - spacing * gapCount;
      h = Math.min(h, inner);
    }
    if (frame.layoutMode === 'HORIZONTAL' && frame.primaryAxisSizingMode === 'FIXED') {
      let others = 0;
      for (const k of kids) if (k.id !== node.id) others += k.width;
      const inner =
        frame.width - (frame.paddingLeft || 0) - (frame.paddingRight || 0) - others - spacing * gapCount;
      w = Math.min(w, inner);
    }
  }

  return { w: Math.max(0, w), h: Math.max(0, h) };
}

/** Positive numbers mean "does not fit". */
export function overflowOf(node: TextNode, avail: Available): { dh: number; dw: number } {
  const mode = node.textAutoResize;
  const nat = measureNatural(node);
  let dh = -Infinity;
  let dw = -Infinity;

  if (mode === 'NONE' || mode === 'TRUNCATE') {
    dh = nat.h - node.height;
    dh = Math.max(dh, nat.h - avail.h);
    dw = nat.w - node.width;
  } else if (mode === 'HEIGHT') {
    dh = nat.h - avail.h;
  } else {
    dh = nat.h - avail.h;
    dw = nat.w - avail.w;
  }
  return { dh, dw };
}

/** Fill ratio of the text inside its available box, used to detect "tight" designs. */
export function fillRatio(node: TextNode, avail: Available): number {
  const nat = measureNatural(node);
  const box =
    node.textAutoResize === 'NONE' || node.textAutoResize === 'TRUNCATE' ? node.height : avail.h;
  if (!isFinite(box) || box <= 0) return 0;
  return nat.h / box;
}

/**
 * Roughly how many characters this layer can hold before it overflows, derived
 * from how much room the *current* content leaves over. Feeding this to an LLM
 * as a budget is far cheaper than translating long and shrinking afterwards.
 *
 * It is an estimate, not a measurement: character count does not scale linearly
 * with box area, and the callers treat it as a hint. Returns null when the
 * layer is unconstrained (nothing useful to say) or too small to reason about.
 */
export function capacityChars(node: TextNode, avail: Available): number | null {
  const len = node.characters.length;
  if (!len) return null;

  const nat = measureNatural(node);
  const mode = node.textAutoResize;
  let factor: number;

  if (mode === 'WIDTH_AND_HEIGHT') {
    // Auto-width: the line grows sideways, so width is the binding constraint.
    if (!isFinite(avail.w) || !(nat.w > 0)) return null;
    factor = avail.w / nat.w;
  } else if (mode === 'HEIGHT') {
    // Fixed width, grows down.
    if (!isFinite(avail.h) || !(nat.h > 0)) return null;
    factor = avail.h / nat.h;
  } else {
    // Fixed box: it may not grow at all, so the box itself is the ceiling.
    const box = isFinite(avail.h) ? Math.min(node.height, avail.h) : node.height;
    if (!(box > 0) || !(nat.h > 0)) return null;
    factor = box / nat.h;
  }

  if (!isFinite(factor) || factor <= 0) return null;
  return Math.max(6, Math.round(len * factor));
}

/* ------------------------------------------------------------------ */
/* Text replacement                                                    */
/* ------------------------------------------------------------------ */

function nearestInstance(node: BaseNode): InstanceNode | null {
  let cur: BaseNode | null = node.parent;
  while (cur) {
    if (cur.type === 'INSTANCE') return cur as InstanceNode;
    cur = cur.parent;
  }
  return null;
}

function snapBoundary(text: string, idx: number, min: number): number {
  if (idx <= min) return min;
  if (idx >= text.length) return text.length;
  const WINDOW = 8;
  for (let d = 0; d <= WINDOW; d++) {
    const a = idx - d;
    if (a > min && /\s/.test(text.charAt(a - 1))) return a;
    const b = idx + d;
    if (b < text.length && /\s/.test(text.charAt(b - 1))) return b;
  }
  return idx;
}

function applySegmentStyle(node: TextNode, start: number, end: number, seg: any): void {
  if (end <= start) return;
  const safe = (property: string, fn: () => void) => {
    try {
      fn();
    } catch (e) {
      // One unsupported property must not abort the rest of the segment.
      swallow('applySegmentStyle: ' + property, e);
    }
  };
  if (seg.fontName && seg.fontName !== figma.mixed) {
    safe('fontName', () => node.setRangeFontName(start, end, seg.fontName));
  }
  if (typeof seg.fontSize === 'number') {
    safe('fontSize', () => node.setRangeFontSize(start, end, seg.fontSize));
  }
  if (seg.textCase) safe('textCase', () => node.setRangeTextCase(start, end, seg.textCase));
  if (seg.textDecoration) {
    safe('textDecoration', () => node.setRangeTextDecoration(start, end, seg.textDecoration));
  }
  if (seg.lineHeight) safe('lineHeight', () => node.setRangeLineHeight(start, end, seg.lineHeight));
  if (seg.letterSpacing) {
    safe('letterSpacing', () => node.setRangeLetterSpacing(start, end, seg.letterSpacing));
  }
  if (seg.fills && seg.fills !== figma.mixed) {
    safe('fills', () => node.setRangeFills(start, end, seg.fills));
  }
  if (seg.hyperlink !== undefined) {
    safe('hyperlink', () => node.setRangeHyperlink(start, end, seg.hyperlink));
  }
  if (typeof seg.indentation === 'number') {
    safe('indentation', () => node.setRangeIndentation(start, end, seg.indentation));
  }
  if (seg.listOptions) safe('listOptions', () => node.setRangeListOptions(start, end, seg.listOptions));
}

/**
 * Replaces the content of a text node.
 *
 * - Single-style node  -> plain assignment, Figma keeps every property.
 * - Mixed-style node   -> assignment destroys per-character styling, so the
 *                         original segments are re-applied over proportional
 *                         ranges of the new string, snapped to word boundaries.
 * - Bound component text property -> routed through instance.setProperties so
 *                         the override survives and Figma does not throw.
 */
export function setTextPreservingStyle(
  node: TextNode,
  newText: string,
  preserveFormatting: boolean
): ApplyMode {
  const refs = (node as any).componentPropertyReferences as
    | { characters?: string }
    | null
    | undefined;
  if (refs && refs.characters) {
    const inst = nearestInstance(node);
    if (inst) {
      try {
        const props: { [key: string]: string } = {};
        props[refs.characters] = newText;
        inst.setProperties(props);
        return 'property';
      } catch (e) {
        swallow('setTextPreservingStyle: setProperties, falling back', e);
      }
    }
  }

  let segments: any[] = [];
  try {
    segments = node.getStyledTextSegments(SEGMENT_FIELDS as unknown as any) as any[];
  } catch (e) {
    swallow('setTextPreservingStyle: getStyledTextSegments', e);
    segments = [];
  }

  const oldText = node.characters;

  if (!preserveFormatting || segments.length <= 1) {
    try {
      node.characters = newText;
      return 'uniform';
    } catch (e) {
      swallow('setTextPreservingStyle: characters assignment', e);
      return 'failed';
    }
  }

  try {
    node.characters = newText;
  } catch (e) {
    swallow('setTextPreservingStyle: characters assignment (mixed)', e);
    return 'failed';
  }

  const oldLen = Math.max(1, oldText.length);
  const newLen = newText.length;
  let cursor = 0;
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const isLast = i === segments.length - 1;
    let end = isLast ? newLen : Math.round((seg.end / oldLen) * newLen);
    if (!isLast) end = snapBoundary(newText, end, cursor);
    end = Math.min(newLen, Math.max(cursor, end));
    if (end === cursor && !isLast) continue;
    applySegmentStyle(node, cursor, isLast ? newLen : end, seg);
    cursor = end;
  }
  return 'remapped';
}

/* ------------------------------------------------------------------ */
/* Auto-fit                                                            */
/* ------------------------------------------------------------------ */

interface SizeSample {
  start: number;
  end: number;
  fontSize: number;
  letterSpacing: LetterSpacing | null;
}

function sampleSizes(node: TextNode): SizeSample[] {
  try {
    const segs = node.getStyledTextSegments(['fontSize', 'letterSpacing']) as any[];
    return segs.map((s) => ({
      start: s.start,
      end: s.end,
      fontSize: typeof s.fontSize === 'number' ? s.fontSize : 12,
      letterSpacing: s.letterSpacing || null,
    }));
  } catch (e) {
    swallow('sampleSizes: getStyledTextSegments', e);
    const size = typeof node.fontSize === 'number' ? node.fontSize : 12;
    return [{ start: 0, end: node.characters.length, fontSize: size, letterSpacing: null }];
  }
}

function applyFontScale(node: TextNode, base: SizeSample[], scale: number): void {
  for (const s of base) {
    if (s.end <= s.start) continue;
    const size = Math.max(ABSOLUTE_MIN_FONT_SIZE, Math.round(s.fontSize * scale * 10) / 10);
    try {
      node.setRangeFontSize(s.start, s.end, size);
    } catch (e) {
      swallow('applyFontScale', e);
    }
  }
}

function applyLetterSpacingDelta(node: TextNode, base: SizeSample[], deltaPercent: number): void {
  for (const s of base) {
    if (s.end <= s.start) continue;
    let basePercent = 0;
    const ls = s.letterSpacing;
    if (ls && ls.unit === 'PERCENT') basePercent = ls.value;
    else if (ls && ls.unit === 'PIXELS' && s.fontSize > 0) basePercent = (ls.value / s.fontSize) * 100;
    try {
      node.setRangeLetterSpacing(s.start, s.end, {
        value: basePercent + deltaPercent,
        unit: 'PERCENT',
      });
    } catch (e) {
      swallow('applyLetterSpacingDelta', e);
    }
  }
}

/**
 * Conservative fit pass, in the documented priority order:
 *   1. leave the layout alone if it already fits
 *   2. let auto-layout absorb the height (already reflected in `avail`)
 *   3. shrink the font, never below MIN_FONT_SCALE
 *   4. tighten letter spacing slightly
 *   5. give up and let the caller raise a warning
 */
export function autoFit(
  node: TextNode,
  avail: Available,
  allowAdjust: boolean,
  wasTight: boolean
): FitResult {
  let of = overflowOf(node, avail);
  const result: FitResult = {
    fits: of.dh <= TOL && of.dw <= TOL,
    fontScale: 1,
    letterSpacingDelta: 0,
    overflowH: Math.max(0, of.dh),
    overflowW: Math.max(0, of.dw),
  };

  if (result.fits) {
    if (allowAdjust && wasTight) growIfRoomy(node, avail, result);
    return result;
  }
  if (!allowAdjust) return result;

  const base = sampleSizes(node);

  for (let scale = 1 - SHRINK_STEP; scale >= MIN_FONT_SCALE - 0.0001; scale -= SHRINK_STEP) {
    applyFontScale(node, base, scale);
    of = overflowOf(node, avail);
    result.fontScale = scale;
    result.overflowH = Math.max(0, of.dh);
    result.overflowW = Math.max(0, of.dw);
    if (of.dh <= TOL && of.dw <= TOL) {
      result.fits = true;
      return result;
    }
  }

  for (const delta of LETTER_SPACING_STEPS) {
    applyLetterSpacingDelta(node, base, delta);
    of = overflowOf(node, avail);
    result.letterSpacingDelta = delta;
    result.overflowH = Math.max(0, of.dh);
    result.overflowW = Math.max(0, of.dw);
    if (of.dh <= TOL && of.dw <= TOL) {
      result.fits = true;
      return result;
    }
  }

  // Out of safe moves. Stay at the guard-rail limit and let the caller warn.
  result.fits = false;
  return result;
}

/**
 * Rewinds a previous `autoFit` so a second pass starts from the designer's own
 * sizes again. Without this, shrinking twice would compound (0.85 × 0.85) and
 * quietly blow through the guard rail the first pass respected.
 *
 * Scaling is relative, so this works equally well before or after the text has
 * been replaced; only the ratio matters.
 */
export function undoFit(node: TextNode, fit: FitResult): void {
  const base = sampleSizes(node);
  if (fit.fontScale > 0 && Math.abs(fit.fontScale - 1) > 0.0001) {
    applyFontScale(node, base, 1 / fit.fontScale);
  }
  if (fit.letterSpacingDelta) {
    applyLetterSpacingDelta(node, sampleSizes(node), -fit.letterSpacingDelta);
  }
}

/** Only used when the source text already filled its box, so growth is intentional. */
function growIfRoomy(node: TextNode, avail: Available, result: FitResult): void {
  const box =
    node.textAutoResize === 'NONE' || node.textAutoResize === 'TRUNCATE' ? node.height : avail.h;
  if (!isFinite(box) || box <= 0) return;
  const nat = measureNatural(node);
  if (nat.h > box * 0.8) return;

  const base = sampleSizes(node);
  let best = 1;
  for (let scale = 1 + GROW_STEP; scale <= MAX_FONT_SCALE + 0.0001; scale += GROW_STEP) {
    applyFontScale(node, base, scale);
    const of = overflowOf(node, avail);
    if (of.dh <= TOL && of.dw <= TOL) best = scale;
    else break;
  }
  applyFontScale(node, base, best);
  result.fontScale = best;
}
