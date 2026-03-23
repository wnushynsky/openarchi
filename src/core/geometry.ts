import type { ModelElement, ModelRelationship, Anchor, Point, RelHit, ResizeHandle } from '../types';

export const GRID = 20;
export const FONT = "'IBM Plex Sans', system-ui, -apple-system, sans-serif";

export function snap(v: number, g: number = GRID / 2): number {
  return Math.round(v / g) * g;
}

export function uid(): string {
  return Math.random().toString(36).substr(2, 9);
}

// ============================================================
// Anchor points (8 per element)
// ============================================================

const ANCHOR_GAP = 8;

export function getAnchors(el: ModelElement): Anchor[] {
  return [
    { x: el.x + el.w / 2, y: el.y - ANCHOR_GAP, side: 'tc' },
    { x: el.x + el.w / 2, y: el.y + el.h + ANCHOR_GAP, side: 'bc' },
    { x: el.x - ANCHOR_GAP, y: el.y + el.h / 2, side: 'ml' },
    { x: el.x + el.w + ANCHOR_GAP, y: el.y + el.h / 2, side: 'mr' },
    { x: el.x + el.w * 0.25, y: el.y - ANCHOR_GAP, side: 'tl' },
    { x: el.x + el.w * 0.75, y: el.y - ANCHOR_GAP, side: 'tr' },
    { x: el.x + el.w * 0.25, y: el.y + el.h + ANCHOR_GAP, side: 'bl' },
    { x: el.x + el.w * 0.75, y: el.y + el.h + ANCHOR_GAP, side: 'br' },
  ];
}

export function nearestAnchor(el: ModelElement, px: number, py: number): Anchor {
  let best: Anchor | null = null;
  let bd = Infinity;
  for (const a of getAnchors(el)) {
    const d = Math.hypot(a.x - px, a.y - py);
    if (d < bd) { bd = d; best = a; }
  }
  return best!;
}

// ============================================================
// Relationship path computation
// ============================================================

export interface RelPath {
  start: Anchor;
  end: Anchor;
  waypoints: Point[];
}

const STRAIGHT_THRESH = 40;

/**
 * Compute the point where a ray from the center of a rect toward a target
 * intersects the rect boundary. Keeps lines straight regardless of element position.
 *
 * When the direction is nearly diagonal, we bias toward the edge that aligns
 * with the dominant axis so connections don't flip sides unexpectedly.
 */
// ============================================================
// Connection Anchoring — exact port of Archi's OrthogonalAnchor
// ============================================================
//
// Archi's OrthogonalAnchor.getLocation() classifies the reference point
// into a grid around the element figure and projects onto the nearest edge.
// There is NO separate connection router — the anchor alone produces the
// orthogonal look. Connections are just straight segments through
// anchor → bendpoints → anchor.

/**
 * OrthogonalAnchor — exact port from Archi.
 *
 * Given an element and a reference point (first/last bendpoint, or remote
 * element center), returns the point on the element boundary where the
 * connection attaches. The anchor always exits perpendicular to the chosen edge.
 */
function orthogonalAnchor(el: ModelElement, ref: Point): Anchor {
  const left = el.x, top = el.y;
  const right = el.x + el.w, bottom = el.y + el.h;

  // Classify reference into which zone it falls in relative to the element.
  // For each axis: is the reference to the left/above, overlapping, or to the right/below?
  const refLeft = ref.x < left;
  const refRight = ref.x > right;
  const refAbove = ref.y < top;
  const refBelow = ref.y > bottom;

  // Straight-side cases: reference is directly above/below/left/right of the element
  if (!refLeft && !refRight && refAbove) {
    // Above — exit from top edge, x follows reference
    return { x: Math.max(left, Math.min(right, ref.x)), y: top, side: 'tc' };
  }
  if (!refLeft && !refRight && refBelow) {
    // Below — exit from bottom edge
    return { x: Math.max(left, Math.min(right, ref.x)), y: bottom, side: 'bc' };
  }
  if (refLeft && !refAbove && !refBelow) {
    // Left — exit from left edge, y follows reference
    return { x: left, y: Math.max(top, Math.min(bottom, ref.y)), side: 'ml' };
  }
  if (refRight && !refAbove && !refBelow) {
    // Right — exit from right edge
    return { x: right, y: Math.max(top, Math.min(bottom, ref.y)), side: 'mr' };
  }

  // Reference is inside the element — pick the nearest edge
  if (!refLeft && !refRight && !refAbove && !refBelow) {
    const dT = ref.y - top, dB = bottom - ref.y;
    const dL = ref.x - left, dR = right - ref.x;
    const min = Math.min(dT, dB, dL, dR);
    if (min === dT) return { x: ref.x, y: top, side: 'tc' };
    if (min === dB) return { x: ref.x, y: bottom, side: 'bc' };
    if (min === dL) return { x: left, y: ref.y, side: 'ml' };
    return { x: right, y: ref.y, side: 'mr' };
  }

  // Diagonal quadrant (reference is in a corner zone — e.g., above-left).
  // Archi picks the edge that faces the dominant direction of the reference.
  const cx = el.x + el.w / 2, cy = el.y + el.h / 2;
  const adx = Math.abs(ref.x - cx);
  const ady = Math.abs(ref.y - cy);

  // Normalize by element dimensions so aspect ratio doesn't bias the choice
  const normDx = adx / (el.w / 2);
  const normDy = ady / (el.h / 2);

  if (normDy >= normDx) {
    // More vertical — exit top or bottom, x at element center
    if (refAbove) return { x: cx, y: top, side: 'tc' };
    return { x: cx, y: bottom, side: 'bc' };
  } else {
    // More horizontal — exit left or right, y at element center
    if (refLeft) return { x: left, y: cy, side: 'ml' };
    return { x: right, y: cy, side: 'mr' };
  }
}

/**
 * Snap an arbitrary point to the nearest point on an element's boundary.
 * Used for manually placed anchor points.
 */
function snapToEdge(el: ModelElement, p: Point): Anchor {
  const candidates: { x: number; y: number; side: string; d: number }[] = [];
  const tx = Math.max(el.x, Math.min(el.x + el.w, p.x));
  candidates.push({ x: tx, y: el.y, side: 'tc', d: Math.hypot(p.x - tx, p.y - el.y) });
  const bx = Math.max(el.x, Math.min(el.x + el.w, p.x));
  candidates.push({ x: bx, y: el.y + el.h, side: 'bc', d: Math.hypot(p.x - bx, p.y - (el.y + el.h)) });
  const ly = Math.max(el.y, Math.min(el.y + el.h, p.y));
  candidates.push({ x: el.x, y: ly, side: 'ml', d: Math.hypot(p.x - el.x, p.y - ly) });
  const ry = Math.max(el.y, Math.min(el.y + el.h, p.y));
  candidates.push({ x: el.x + el.w, y: ry, side: 'mr', d: Math.hypot(p.x - (el.x + el.w), p.y - ry) });
  candidates.sort((a, b) => a.d - b.d);
  return { x: candidates[0].x, y: candidates[0].y, side: candidates[0].side };
}

export function getRelPoints(rel: ModelRelationship, elements: ModelElement[], elementMap?: Map<string, ModelElement>): RelPath | null {
  const src = elementMap ? elementMap.get(rel.sourceId) : elements.find(e => e.id === rel.sourceId);
  const tgt = elementMap ? elementMap.get(rel.targetId) : elements.find(e => e.id === rel.targetId);
  if (!src || !tgt) return null;

  const waypoints = (rel.waypoints || []).map(wp => ({ x: wp.x, y: wp.y }));

  // Compute reference points for anchors.
  // Archi: when the reference is the remote element center and the elements overlap,
  // use the midpoint of the overlapping region instead.
  function remoteRef(el: ModelElement, remote: ModelElement): Point {
    const rc = { x: remote.x + remote.w / 2, y: remote.y + remote.h / 2 };
    const oL = Math.max(el.x, remote.x), oR = Math.min(el.x + el.w, remote.x + remote.w);
    const oT = Math.max(el.y, remote.y), oB = Math.min(el.y + el.h, remote.y + remote.h);
    if (oL < oR && oT < oB) return { x: (oL + oR) / 2, y: (oT + oB) / 2 };
    return rc;
  }

  // Source anchor
  let sA: Anchor;
  if (rel.sourceAnchor) {
    sA = snapToEdge(src, rel.sourceAnchor);
  } else {
    const ref = waypoints.length > 0 ? waypoints[0] : remoteRef(src, tgt);
    sA = orthogonalAnchor(src, ref);
  }

  // Target anchor
  let tA: Anchor;
  if (rel.targetAnchor) {
    tA = snapToEdge(tgt, rel.targetAnchor);
  } else {
    const ref = waypoints.length > 0 ? waypoints[waypoints.length - 1] : remoteRef(tgt, src);
    tA = orthogonalAnchor(tgt, ref);
  }

  // No additional routing — Archi draws straight segments through
  // anchor → waypoints → anchor. The orthogonal look comes from
  // the anchor placement, not from a separate router.
  return { start: sA, end: tA, waypoints };
}

// Get a point along a polyline at position t (0–1)
export function pointOnPath(allPts: Point[], t: number): Point {
  if (allPts.length < 2) return allPts[0] || { x: 0, y: 0 };

  let totalLen = 0;
  const segLens: number[] = [];
  for (let i = 0; i < allPts.length - 1; i++) {
    const d = Math.hypot(allPts[i + 1].x - allPts[i].x, allPts[i + 1].y - allPts[i].y);
    segLens.push(d);
    totalLen += d;
  }
  if (totalLen === 0) return allPts[0];

  const targetDist = t * totalLen;
  let accum = 0;
  for (let i = 0; i < segLens.length; i++) {
    if (accum + segLens[i] >= targetDist) {
      const frac = (targetDist - accum) / segLens[i];
      return {
        x: allPts[i].x + (allPts[i + 1].x - allPts[i].x) * frac,
        y: allPts[i].y + (allPts[i + 1].y - allPts[i].y) * frac,
      };
    }
    accum += segLens[i];
  }
  return allPts[allPts.length - 1];
}

// Find nearest t on polyline to a world point
export function nearestTOnPath(allPts: Point[], wx: number, wy: number): number {
  let totalLen = 0;
  const segLens: number[] = [];
  for (let i = 0; i < allPts.length - 1; i++) {
    const d = Math.hypot(allPts[i + 1].x - allPts[i].x, allPts[i + 1].y - allPts[i].y);
    segLens.push(d);
    totalLen += d;
  }
  if (totalLen === 0) return 0.5;

  let bestT = 0.5;
  let bestDist = Infinity;
  let accum = 0;

  for (let i = 0; i < segLens.length; i++) {
    const a = allPts[i], b = allPts[i + 1];
    const dx = b.x - a.x, dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    let ft = len2 === 0 ? 0 : ((wx - a.x) * dx + (wy - a.y) * dy) / len2;
    ft = Math.max(0, Math.min(1, ft));
    const px = a.x + ft * dx, py = a.y + ft * dy;
    const dist = Math.hypot(wx - px, wy - py);
    if (dist < bestDist) {
      bestDist = dist;
      bestT = (accum + ft * segLens[i]) / totalLen;
    }
    accum += segLens[i];
  }
  return Math.max(0.05, Math.min(0.95, bestT));
}

// ============================================================
// Hit testing
// ============================================================

export function hitTestElement(elements: ModelElement[], wx: number, wy: number, getLayer: (type: string) => string | undefined, isNote: (type: string) => boolean): ModelElement | null {
  // Non-composite first (they're on top)
  for (let i = elements.length - 1; i >= 0; i--) {
    const el = elements[i];
    if (getLayer(el.type) === 'composite' && !isNote(el.type)) continue;
    if (wx >= el.x && wx <= el.x + el.w && wy >= el.y && wy <= el.y + el.h) return el;
  }
  // Then composite
  for (let i = elements.length - 1; i >= 0; i--) {
    const el = elements[i];
    if (!(getLayer(el.type) === 'composite' && !isNote(el.type))) continue;
    if (wx >= el.x && wx <= el.x + el.w && wy >= el.y && wy <= el.y + el.h) return el;
  }
  return null;
}

export function hitTestAnchor(elements: ModelElement[], wx: number, wy: number, getLayer: (type: string) => string | undefined, isNote: (type: string) => boolean): { elId: string; side: string } | null {
  for (let i = elements.length - 1; i >= 0; i--) {
    const el = elements[i];
    if (getLayer(el.type) === 'composite' && !isNote(el.type)) continue;
    for (const a of getAnchors(el)) {
      if (Math.hypot(a.x - wx, a.y - wy) < 8) return { elId: el.id, side: a.side };
    }
  }
  return null;
}

/** Hit test start/end endpoint of a relationship. Only checks the given rel (should be the selected one). */
export function hitTestEndpoint(rel: ModelRelationship, elements: ModelElement[], wx: number, wy: number): 'source' | 'target' | null {
  const pts = getRelPoints(rel, elements);
  if (!pts) return null;
  if (Math.hypot(pts.start.x - wx, pts.start.y - wy) < 10) return 'source';
  if (Math.hypot(pts.end.x - wx, pts.end.y - wy) < 10) return 'target';
  return null;
}

export function hitTestWaypoint(relationships: ModelRelationship[], wx: number, wy: number): { relId: string; wpIdx: number } | null {
  for (const r of relationships) {
    if (!r.waypoints) continue;
    for (let i = 0; i < r.waypoints.length; i++) {
      if (Math.hypot(r.waypoints[i].x - wx, r.waypoints[i].y - wy) < 8) return { relId: r.id, wpIdx: i };
    }
  }
  return null;
}

export function hitTestRelationship(relationships: ModelRelationship[], elements: ModelElement[], wx: number, wy: number): RelHit | null {
  for (const rel of relationships) {
    const pts = getRelPoints(rel, elements);
    if (!pts) continue;
    const all = [pts.start, ...pts.waypoints, pts.end];
    for (let i = 0; i < all.length - 1; i++) {
      const a = all[i], b = all[i + 1];
      const dx = b.x - a.x, dy = b.y - a.y;
      const len2 = dx * dx + dy * dy;
      let t = len2 === 0 ? 0 : ((wx - a.x) * dx + (wy - a.y) * dy) / len2;
      t = Math.max(0, Math.min(1, t));
      if (Math.hypot(wx - (a.x + t * dx), wy - (a.y + t * dy)) < 8) return { rel, segIdx: i };
    }
  }
  return null;
}

export function hitTestLabel(relationships: ModelRelationship[], elements: ModelElement[], wx: number, wy: number): ModelRelationship | null {
  for (const rel of relationships) {
    if (!rel.name) continue;
    const pts = getRelPoints(rel, elements);
    if (!pts) continue;
    const allPts = [pts.start, ...pts.waypoints, pts.end];
    const lp = rel.labelPos ?? 0.5;
    const pt = pointOnPath(allPts, lp);
    if (Math.abs(wx - pt.x) < 40 && Math.abs(wy - pt.y) < 12) return rel;
  }
  return null;
}

// ============================================================
// Resize handles
// ============================================================

export function getResizeHandles(el: ModelElement): { handle: ResizeHandle; x: number; y: number }[] {
  const { x, y, w, h } = el;
  return [
    { handle: 'nw', x, y },
    { handle: 'n', x: x + w / 2, y },
    { handle: 'ne', x: x + w, y },
    { handle: 'e', x: x + w, y: y + h / 2 },
    { handle: 'se', x: x + w, y: y + h },
    { handle: 's', x: x + w / 2, y: y + h },
    { handle: 'sw', x, y: y + h },
    { handle: 'w', x, y: y + h / 2 },
  ];
}

export function hitTestResizeHandle(el: ModelElement, wx: number, wy: number): ResizeHandle | null {
  for (const h of getResizeHandles(el)) {
    if (Math.hypot(h.x - wx, h.y - wy) < 7) return h.handle;
  }
  return null;
}

export const HANDLE_CURSORS: Record<ResizeHandle, string> = {
  nw: 'nwse-resize', n: 'ns-resize', ne: 'nesw-resize', e: 'ew-resize',
  se: 'nwse-resize', s: 'ns-resize', sw: 'nesw-resize', w: 'ew-resize',
};

// ============================================================
// Smart-snap: align to other elements' edges & centers
// ============================================================

export interface SnapGuide {
  axis: 'x' | 'y';
  value: number;        // world-coordinate of the guide line
  type: 'edge' | 'center';
}

export interface SnapResult {
  x: number;
  y: number;
  guides: SnapGuide[];
}

const SNAP_THRESHOLD = 6;

/**
 * Given a dragged element's proposed bounds, snap it to nearby element
 * edges / centers and return the adjusted position + active guides.
 */
export function snapToElements(
  proposed: { x: number; y: number; w: number; h: number },
  others: ModelElement[],
  threshold: number = SNAP_THRESHOLD,
): SnapResult {
  const guides: SnapGuide[] = [];
  let bestDx: number | null = null;
  let bestDxDist = Infinity;
  let bestDy: number | null = null;
  let bestDyDist = Infinity;

  // Edges and centers of the proposed element
  const pLeft   = proposed.x;
  const pRight  = proposed.x + proposed.w;
  const pCx     = proposed.x + proposed.w / 2;
  const pTop    = proposed.y;
  const pBottom = proposed.y + proposed.h;
  const pCy     = proposed.y + proposed.h / 2;

  for (const other of others) {
    const oLeft   = other.x;
    const oRight  = other.x + other.w;
    const oCx     = other.x + other.w / 2;
    const oTop    = other.y;
    const oBottom = other.y + other.h;
    const oCy     = other.y + other.h / 2;

    // X-axis candidates: left, right, center of proposed vs left, right, center of other
    const xCandidates: { proposed: number; target: number; type: 'edge' | 'center' }[] = [
      { proposed: pLeft,  target: oLeft,  type: 'edge' },
      { proposed: pLeft,  target: oRight, type: 'edge' },
      { proposed: pRight, target: oLeft,  type: 'edge' },
      { proposed: pRight, target: oRight, type: 'edge' },
      { proposed: pCx,    target: oCx,    type: 'center' },
    ];

    for (const c of xCandidates) {
      const dist = Math.abs(c.proposed - c.target);
      if (dist < threshold && dist < bestDxDist) {
        bestDxDist = dist;
        bestDx = c.target - c.proposed;
      }
    }

    // Y-axis candidates
    const yCandidates: { proposed: number; target: number; type: 'edge' | 'center' }[] = [
      { proposed: pTop,    target: oTop,    type: 'edge' },
      { proposed: pTop,    target: oBottom, type: 'edge' },
      { proposed: pBottom, target: oTop,    type: 'edge' },
      { proposed: pBottom, target: oBottom, type: 'edge' },
      { proposed: pCy,     target: oCy,     type: 'center' },
    ];

    for (const c of yCandidates) {
      const dist = Math.abs(c.proposed - c.target);
      if (dist < threshold && dist < bestDyDist) {
        bestDyDist = dist;
        bestDy = c.target - c.proposed;
      }
    }
  }

  const snappedX = bestDx !== null ? proposed.x + bestDx : proposed.x;
  const snappedY = bestDy !== null ? proposed.y + bestDy : proposed.y;

  // Build guide lines for all matching edges at the snapped position
  if (bestDx !== null) {
    const sLeft  = snappedX;
    const sRight = snappedX + proposed.w;
    const sCx    = snappedX + proposed.w / 2;
    for (const other of others) {
      const oLeft  = other.x;
      const oRight = other.x + other.w;
      const oCx    = other.x + other.w / 2;
      if (Math.abs(sLeft - oLeft) < 1 || Math.abs(sLeft - oRight) < 1)   guides.push({ axis: 'x', value: sLeft,  type: 'edge' });
      if (Math.abs(sRight - oLeft) < 1 || Math.abs(sRight - oRight) < 1) guides.push({ axis: 'x', value: sRight, type: 'edge' });
      if (Math.abs(sCx - oCx) < 1)                                        guides.push({ axis: 'x', value: sCx,    type: 'center' });
    }
  }
  if (bestDy !== null) {
    const sTop    = snappedY;
    const sBottom = snappedY + proposed.h;
    const sCy     = snappedY + proposed.h / 2;
    for (const other of others) {
      const oTop    = other.y;
      const oBottom = other.y + other.h;
      const oCy     = other.y + other.h / 2;
      if (Math.abs(sTop - oTop) < 1 || Math.abs(sTop - oBottom) < 1)       guides.push({ axis: 'y', value: sTop,    type: 'edge' });
      if (Math.abs(sBottom - oTop) < 1 || Math.abs(sBottom - oBottom) < 1) guides.push({ axis: 'y', value: sBottom, type: 'edge' });
      if (Math.abs(sCy - oCy) < 1)                                          guides.push({ axis: 'y', value: sCy,     type: 'center' });
    }
  }

  // Deduplicate guides
  const seen = new Set<string>();
  const unique = guides.filter(g => {
    const k = `${g.axis}:${g.value}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  return { x: snappedX, y: snappedY, guides: unique };
}

/**
 * Snap during resize — snaps the edges being resized to other element edges.
 * Returns adjusted bounds + guides.
 */
export function snapResizeToElements(
  proposed: { x: number; y: number; w: number; h: number },
  handle: ResizeHandle,
  others: ModelElement[],
  threshold: number = SNAP_THRESHOLD,
): SnapResult & { w: number; h: number } {
  const guides: SnapGuide[] = [];
  let { x, y, w, h } = proposed;

  // Which edges are being resized?
  const resizingLeft   = handle.includes('w');
  const resizingRight  = handle.includes('e');
  const resizingTop    = handle.includes('n');
  const resizingBottom = handle.includes('s');

  for (const other of others) {
    const oLeft   = other.x;
    const oRight  = other.x + other.w;
    const oTop    = other.y;
    const oBottom = other.y + other.h;

    if (resizingLeft) {
      for (const target of [oLeft, oRight]) {
        if (Math.abs(x - target) < threshold) {
          const diff = target - x;
          x += diff;
          w -= diff;
          guides.push({ axis: 'x', value: target, type: 'edge' });
        }
      }
    }
    if (resizingRight) {
      const right = x + w;
      for (const target of [oLeft, oRight]) {
        if (Math.abs(right - target) < threshold) {
          w = target - x;
          guides.push({ axis: 'x', value: target, type: 'edge' });
        }
      }
    }
    if (resizingTop) {
      for (const target of [oTop, oBottom]) {
        if (Math.abs(y - target) < threshold) {
          const diff = target - y;
          y += diff;
          h -= diff;
          guides.push({ axis: 'y', value: target, type: 'edge' });
        }
      }
    }
    if (resizingBottom) {
      const bottom = y + h;
      for (const target of [oTop, oBottom]) {
        if (Math.abs(bottom - target) < threshold) {
          h = target - y;
          guides.push({ axis: 'y', value: target, type: 'edge' });
        }
      }
    }
  }

  // Also snap to match width/height of other elements
  if (resizingRight || resizingLeft) {
    for (const other of others) {
      if (Math.abs(w - other.w) < threshold) {
        if (resizingRight) w = other.w;
        else { x = x + (proposed.w - other.w); w = other.w; }
        // Don't add a guide for size-match — it's implicit
        break;
      }
    }
  }
  if (resizingBottom || resizingTop) {
    for (const other of others) {
      if (Math.abs(h - other.h) < threshold) {
        if (resizingBottom) h = other.h;
        else { y = y + (proposed.h - other.h); h = other.h; }
        break;
      }
    }
  }

  w = Math.max(60, w);
  h = Math.max(40, h);

  // Deduplicate guides
  const seen = new Set<string>();
  const unique = guides.filter(g => {
    const k = `${g.axis}:${g.value}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  return { x, y, w, h, guides: unique };
}

export function hitTestPopout(elements: ModelElement[], wx: number, wy: number): string | null {
  for (const el of elements) {
    if (!el.linkedViewId) continue;
    const px = el.x + el.w - 16, py = el.y + el.h - 16;
    if (Math.hypot(wx - px, wy - py) < 14) return el.linkedViewId;
  }
  return null;
}
